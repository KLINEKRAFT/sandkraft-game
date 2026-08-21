/* Per-face weathering for an imported prop, applied at import time.

   Why this exists: a low-poly asset pack usually ships one solid-fill PNG as
   its "texture" — both of the CraftPix desert packs in `assets/packs` are a
   single colour, 177,70,18, over every texel of a 512² image. Baking that to
   vertex colours is correct and gives you a mesh where every face is exactly
   the same colour, which under a flat-shaded renderer reads as painted plastic:
   the only thing separating one facet from the next is the lambert term.

   Rock does not look like that, and the terrain shader in this game already
   knows why — it grew a bedding term, desert varnish and a coarse relief for
   exactly this reason. This does the same four things to a mesh, once, at
   import, and bakes the result into the vertex colours the prop shader already
   reads. No shader change, no per-frame cost.

   The lesson the terrain shader learned the hard way is repeated here: bedding
   has to be a *face* phenomenon. Modulating colour by height everywhere paints
   stripes across the flat top of a plateau too, which reads as a candy cane —
   so every band and varnish term fades out as the surface turns skyward.

   Deterministic: the jitter is hashed off the quantised centroid, so importing
   the same mesh twice gives the same bytes. */

const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* one hash, three ways — a scalar in 0..1 from three quantised coordinates */
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* value noise in one dimension, for the bedding — cheap, and a stack of
   sedimentary beds is genuinely one-dimensional */
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i;
  const a = hash3(i, seed, 7), b = hash3(i + 1, seed, 7);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}
function fbm1(x, seed) {
  return (noise1(x, seed) * 0.55 + noise1(x * 2.3 + 11.7, seed + 1) * 0.30 +
          noise1(x * 5.1 - 3.4, seed + 2) * 0.15) * 2 - 1;      /* -1..1 */
}

/* Desert varnish is a manganese-iron film that builds on stable rock faces
   over millennia — dark, near black-brown. Dust is the opposite end: pale,
   warm, and it settles on anything that faces the sky. */
const VARNISH = [0.15, 0.10, 0.075];
const DUST    = [0.86, 0.77, 0.60];

export function weather(tris, opts = {}) {
  const amount  = opts.amount  ?? 1;
  if (amount <= 0) return null;
  const bands   = (opts.bands   ?? 0.16) * amount;   /* sedimentary bedding depth */
  const varnish = (opts.varnish ?? 0.34) * amount;   /* how far a sheer face goes to varnish */
  const dust    = (opts.dust    ?? 0.20) * amount;   /* how far a sky-facing one goes to dust */
  const jitter  = (opts.jitter  ?? 0.10) * amount;   /* per-facet break-up */
  const seed    = opts.seed ?? 1337;                 /* the world's seed, for the same reason */

  /* Band spacing is set from the mesh's own height rather than in metres, so a
     0.4 m pebble and a 26 m plateau both come out with a handful of beds
     instead of the pebble getting one and the plateau getting two hundred. */
  let lo = 1e9, hi = -1e9;
  for (const t of tris) for (const p of t.p) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  const span = Math.max(hi - lo, 1e-4);
  const beds = opts.beds ?? 6;

  const before = { l: 0, n: 0, min: 1, max: 0 };
  const after = { l: 0, n: 0, min: 1, max: 0 };
  const tally = (s, c) => { const l = lum(c); s.l += l; s.n++; if (l < s.min) s.min = l; if (l > s.max) s.max = l; };

  for (const t of tris) {
    tally(before, t.c);
    const [a, b, c] = t.p;
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const nx = u[1]*v[2] - u[2]*v[1], ny = u[2]*v[0] - u[0]*v[2], nz = u[0]*v[1] - u[1]*v[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    const up = clamp01(ny / nl);                    /* 1 faces the sky, 0 is a wall */
    const wall = 1 - up;

    const cy = (a[1] + b[1] + c[1]) / 3;
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;

    /* bedding: swing about the base colour rather than between two colours, so
       the formation keeps one identity top to bottom — and fade it out on
       anything approaching horizontal */
    const bed = fbm1((cy - lo) / span * beds, seed) * bands * (wall * wall);

    /* varnish streaks down the sheer faces; dust settles on the shoulders */
    const vk = wall * wall * wall * varnish;
    const dk = up * up * dust;

    /* facet break-up, quantised at 25 cm so a mesh keeps its patches when it
       is decimated rather than turning to noise */
    const jk = (hash3(Math.round(cx * 4), Math.round(cy * 4), Math.round(cz * 4)) - 0.5) * 2 * jitter;

    let col = [t.c[0] * (1 + bed + jk), t.c[1] * (1 + bed + jk), t.c[2] * (1 + bed + jk)];
    col = mix(col, VARNISH, vk);
    col = mix(col, DUST, dk);
    t.c = [clamp01(col[0]), clamp01(col[1]), clamp01(col[2])];
    tally(after, t.c);
  }

  return {
    before: { mean: before.l / (before.n || 1), min: before.min, max: before.max },
    after: { mean: after.l / (after.n || 1), min: after.min, max: after.max }
  };
}
