#!/usr/bin/env node
/* Import a rigged, animated character into index.html.

     node tools/import-character.mjs assets/outdoorsman.glb --tris=1800

   Options
     --tris=1800     triangle budget after decimation
     --height=1.9    scale so the character stands this tall, in metres
     --albedo=0.45   normalise mean baked albedo luminance (omit to keep)
     --dry           report, write nothing

   The mesh keeps its skin: positions stay in skin space and every vertex keeps
   its four joint bindings, because a skinned mesh cannot be flattened to world
   space the way tools/import-model.mjs flattens the truck.

   A baseColor texture is baked to vertex colours — this renderer has no texture
   pipeline, and a 1K PNG is twice the size of the entire game. High-frequency
   pattern (a plaid shirt, say) becomes an average at whatever the triangle
   density is; flat regions come through exactly.
   No dependencies. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSkin, restWorld } from './parse-skin.mjs';
import { decodePNG, sampleRGB } from './png.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: import-character.mjs <rigged.glb> [--tris=N] [--height=M]'); process.exit(1); }
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const flag = k => args.includes('--' + k);
const TRIS = +opt('tris', 1800);
const SLIVER = +opt('sliver', 0.02);   /* triangle quality floor after clustering */
const HEIGHT = opt('height', null) === null ? null : +opt('height');
const HTML = opt('html', 'index.html');
const log = (...a) => console.log(...a);

const S = parseSkin(file);
log(`${file}: ${S.indices.length / 3} triangles, ${S.skeleton.length} joints, ${S.clips.length} clip(s)`);

/* ----------------------------------------------------------- vertices --- */
/* expand to per-corner records so decimation can move them freely */
const V = S.verts;
let corners = S.indices.map(i => ({
  p: [V.pos[i * 3], V.pos[i * 3 + 1], V.pos[i * 3 + 2]],
  n: V.nrm ? [V.nrm[i * 3], V.nrm[i * 3 + 1], V.nrm[i * 3 + 2]] : [0, 1, 0],
  uv: V.uv ? [V.uv[i * 2], V.uv[i * 2 + 1]] : [0, 0],
  j: [V.joints[i * 4], V.joints[i * 4 + 1], V.joints[i * 4 + 2], V.joints[i * 4 + 3]],
  w: [V.weights[i * 4], V.weights[i * 4 + 1], V.weights[i * 4 + 2], V.weights[i * 4 + 3]],
  c: null
}));

/* ------------------------------------------------------------- colour --- */
if (S.image) {
  if (!/png/i.test(S.image.mime))
    throw new Error(`baseColor texture is ${S.image.mime}; re-export with a PNG texture`);
  const img = decodePNG(S.image.bytes);
  for (const c of corners) c.c = sampleRGB(img, c.uv[0], c.uv[1]);
  log(`  texture  ${img.width}x${img.height} baked to vertex colours`);
} else if (V.col) {
  const n = V.colN;
  corners = corners.map((c, k) => {
    const i = S.indices[k];
    return { ...c, c: [V.col[i * n], V.col[i * n + 1], V.col[i * n + 2]] };
  });
  log('  colour   from COLOR_0');
} else {
  const b = V.baseColorFactor || [0.68, 0.68, 0.68];
  for (const c of corners) c.c = [...b];
  log('  colour   flat baseColorFactor');
}
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
{
  const mean = [0, 0, 0];
  for (const c of corners) for (let k = 0; k < 3; k++) mean[k] += c.c[k] / corners.length;
  const want = opt('albedo', null);
  if (want !== null) {
    const f = +want / (lum(mean) || 1e-6);
    for (const c of corners) c.c = c.c.map(v => Math.min(1, v * f));
    log(`  albedo   mean luminance ${lum(mean).toFixed(3)} -> ${(+want).toFixed(3)} (x${f.toFixed(2)})`);
  } else {
    log(`  albedo   mean luminance ${lum(mean).toFixed(3)}` +
        (lum(mean) < 0.30 ? '  *** dark: the flat sky term will push this cool, try --albedo=0.45 ***' : ''));
  }
}

/* --------------------------------------------------------------- fit --- */
{
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const c of corners) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c.p[a]); hi[a] = Math.max(hi[a], c.p[a]); }
  log(`  extents  x=${(hi[0] - lo[0]).toFixed(2)} y=${(hi[1] - lo[1]).toFixed(2)} z=${(hi[2] - lo[2]).toFixed(2)} m,` +
      ` feet at y=${lo[1].toFixed(3)}`);
  if (HEIGHT) {
    const k = HEIGHT / (hi[1] - lo[1]);
    for (const c of corners) c.p = c.p.map(v => v * k);
    for (const b of S.skeleton) { b.t = b.t.map(v => v * k); scaleInverseBind(b, k); }
    for (const cl of S.clips) for (const t of cl.tracks)
      if (t.path === 't') t.values = t.values.map(v => v * k);
    log(`  scaled   x${k.toFixed(3)} to ${HEIGHT} m`);
  }
}
function scaleInverseBind(b, k) {
  /* inverse bind maps world -> joint space, so a uniform world scale of k
     scales its translation column by k and leaves the rotation basis alone */
  b.inverseBind = b.inverseBind.slice();
  for (let i = 12; i < 15; i++) b.inverseBind[i] *= k;
}

/* ---------------------------------------------------------- decimate --- */
/* Vertex clustering, but skin-aware: a merged vertex takes the joints, weights
   and colour of whichever original vertex sat nearest the cluster centroid.
   Averaging bindings across different joints would tear the mesh, and averaging
   colours across a pattern boundary muddies it. */
function decimateSkinned(cs, budget) {
  const triCount = cs.length / 3;
  if (triCount <= budget) return cs;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const c of cs) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c.p[a]); hi[a] = Math.max(hi[a], c.p[a]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  let loN = 8, hiN = 900, best = null;
  for (let iter = 0; iter < 16; iter++) {
    const N = Math.round((loN + hiN) / 2), cell = diag / N;
    const key = p => `${Math.floor((p[0] - lo[0]) / cell)},${Math.floor((p[1] - lo[1]) / cell)},${Math.floor((p[2] - lo[2]) / cell)}`;
    const rep = new Map();
    for (const c of cs) {
      const k = key(c.p), r = rep.get(k);
      if (r) { for (let a = 0; a < 3; a++) r.s[a] += c.p[a]; r.n++; r.members.push(c); }
      else rep.set(k, { s: [...c.p], n: 1, members: [c] });
    }
    for (const r of rep.values()) {
      r.p = r.s.map(v => v / r.n);
      let bestD = Infinity;
      for (const m of r.members) {
        const d = (m.p[0] - r.p[0]) ** 2 + (m.p[1] - r.p[1]) ** 2 + (m.p[2] - r.p[2]) ** 2;
        if (d < bestD) { bestD = d; r.src = m; }
      }
      r.members = null;
    }
    const out = [];
    for (let t = 0; t < cs.length; t += 3) {
      const k = [key(cs[t].p), key(cs[t + 1].p), key(cs[t + 2].p)];
      if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;   /* collapsed */
      for (let i = 0; i < 3; i++) {
        const r = rep.get(k[i]);
        out.push({ p: r.p, n: r.src.n, uv: r.src.uv, j: r.src.j, w: r.src.w, c: r.src.c });
      }
    }
    if (!best || Math.abs(out.length - budget * 3) < Math.abs(best.length - budget * 3)) best = out;
    if (out.length / 3 > budget) hiN = N; else loN = N;
    if (hiN - loN <= 1) break;
  }
  return best;
}
const before = corners.length / 3;
corners = decimateSkinned(corners, TRIS);
log(`  mesh     ${before} -> ${corners.length / 3} triangles`);

/* Clustering pulls every vertex to its cell centroid, which does not remove
   fine detail like fingers so much as stretch it into spikes. Cull on triangle
   quality — 1 for equilateral, towards 0 for a sliver — as a separate pass, so
   the threshold cannot fight the cell-size search that hit the budget. */
function triQuality(P) {
  const e = [0, 1, 2].map(i => {
    const a = P[i], b = P[(i + 1) % 3];
    return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
  });
  const u = [P[1][0]-P[0][0], P[1][1]-P[0][1], P[1][2]-P[0][2]];
  const v = [P[2][0]-P[0][0], P[2][1]-P[0][1], P[2][2]-P[0][2]];
  const cr = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  return (4 * Math.sqrt(3) * 0.5 * Math.hypot(cr[0], cr[1], cr[2])) / (e[0] + e[1] + e[2] || 1e-12);
}
if (flag('quality-histogram')) {
  const bins = new Array(10).fill(0);
  for (let t = 0; t < corners.length; t += 3)
    bins[Math.min(9, Math.floor(triQuality([corners[t].p, corners[t+1].p, corners[t+2].p]) * 10))]++;
  log('  quality  ' + bins.map((n, i) => `${(i/10).toFixed(1)}:${n}`).join(' '));
}
if (SLIVER > 0) {
  const keep = [];
  let dropped = 0;
  for (let t = 0; t < corners.length; t += 3) {
    if (triQuality([corners[t].p, corners[t+1].p, corners[t+2].p]) < SLIVER) { dropped++; continue; }
    keep.push(corners[t], corners[t+1], corners[t+2]);
  }
  corners = keep;
  log(`  slivers  ${dropped} dropped below quality ${SLIVER}, ${corners.length / 3} triangles left`);
}

/* flat normals from the surviving winding — the source is 92% flat-shaded and
   clustering leaves the interpolated ones meaningless anyway */
for (let t = 0; t < corners.length; t += 3) {
  const [a, b, c] = [corners[t].p, corners[t + 1].p, corners[t + 2].p];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
  corners[t].n = corners[t + 1].n = corners[t + 2].n = n;
}

/* ----------------------------------------------------------- packing --- */
/* SKC1: a skinned mesh, its skeleton and its clips in one blob.
   vertex = int16 pos x3 | int8 nrm x3 | uint8 rgb x3 | uint8 joint x4 | uint8 weight x4 */
function pack() {
  let m = 0;
  for (const c of corners) for (const v of c.p) m = Math.max(m, Math.abs(v));
  const ps = m / 32000 || 1e-6;
  const parts = [];
  const head = Buffer.alloc(16);
  head.write('SKC1', 0, 'ascii');
  head.writeUInt32LE(corners.length, 4);
  head.writeFloatLE(ps, 8);
  head.writeUInt16LE(S.skeleton.length, 12);
  head.writeUInt16LE(S.clips.length, 14);
  parts.push(head);

  const vb = Buffer.alloc(corners.length * 20);
  let o = 0;
  for (const c of corners) {
    for (let a = 0; a < 3; a++) vb.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(c.p[a] / ps))), o + a * 2);
    const nl = Math.hypot(...c.n) || 1;
    for (let a = 0; a < 3; a++) vb.writeInt8(Math.max(-127, Math.min(127, Math.round(c.n[a] / nl * 127))), o + 6 + a);
    for (let a = 0; a < 3; a++) vb.writeUInt8(Math.max(0, Math.min(255, Math.round(c.c[a] * 255))), o + 9 + a);
    /* renormalise weights into 0..255 so the shader can divide by 255 and get 1 */
    const ws = c.w.reduce((s, v) => s + v, 0) || 1;
    let acc = 0;
    const q = c.w.map(v => Math.round(v / ws * 255));
    for (let a = 0; a < 4; a++) acc += q[a];
    q[0] += 255 - acc;                                    /* put the rounding error on the dominant bone */
    for (let a = 0; a < 4; a++) { vb.writeUInt8(Math.min(255, c.j[a]), o + 12 + a); vb.writeUInt8(Math.max(0, Math.min(255, q[a])), o + 16 + a); }
    o += 20;
  }
  parts.push(vb);

  /* skeleton: parent, rest TRS, inverse bind */
  const sb = Buffer.alloc(S.skeleton.length * (1 + 40 + 64));
  o = 0;
  for (const b of S.skeleton) {
    sb.writeInt8(b.parent, o); o += 1;
    for (const v of b.t) { sb.writeFloatLE(v, o); o += 4; }
    for (const v of b.r) { sb.writeFloatLE(v, o); o += 4; }
    for (const v of b.s) { sb.writeFloatLE(v, o); o += 4; }
    for (const v of b.inverseBind) { sb.writeFloatLE(v, o); o += 4; }
  }
  parts.push(sb);

  /* clips: drop tracks that never move, quantise rotations to int16 */
  let kept = 0, dropped = 0;
  for (const cl of S.clips) {
    const live = cl.tracks.filter(t => {
      const n = t.path === 'r' ? 4 : 3;
      for (let k = 1; k < t.times.length; k++)
        for (let c = 0; c < n; c++)
          if (Math.abs(t.values[k * n + c] - t.values[c]) > 1e-4) return true;
      return false;
    });
    dropped += cl.tracks.length - live.length; kept += live.length;
    const nameB = Buffer.from(cl.name, 'ascii');
    const h = Buffer.alloc(1 + nameB.length + 4 + 2);
    h.writeUInt8(nameB.length, 0); nameB.copy(h, 1);
    h.writeFloatLE(cl.duration, 1 + nameB.length);
    h.writeUInt16LE(live.length, 5 + nameB.length);
    parts.push(h);
    for (const t of live) {
      const n = t.path === 'r' ? 4 : 3;
      const th = Buffer.alloc(4);
      th.writeUInt8(t.joint, 0);
      th.writeUInt8(t.path === 't' ? 0 : t.path === 'r' ? 1 : 2, 1);
      th.writeUInt16LE(t.times.length, 2);
      parts.push(th);
      const tb = Buffer.alloc(t.times.length * 2);
      for (let k = 0; k < t.times.length; k++) tb.writeUInt16LE(Math.min(65535, Math.round(t.times[k] * 1000)), k * 2);
      parts.push(tb);
      if (t.path === 'r') {
        const vb2 = Buffer.alloc(t.times.length * 8);
        for (let k = 0; k < t.times.length * 4; k++)
          vb2.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(t.values[k] * 32767))), k * 2);
        parts.push(vb2);
      } else {
        const vb2 = Buffer.alloc(t.times.length * n * 4);
        for (let k = 0; k < t.times.length * n; k++) vb2.writeFloatLE(t.values[k], k * 4);
        parts.push(vb2);
      }
    }
  }
  log(`  clips    ${kept} live tracks, ${dropped} constant tracks dropped`);
  return Buffer.concat(parts).toString('base64');
}

const blob = pack();
const payload = {
  data: blob,
  tris: corners.length / 3,
  joints: S.skeleton.length,
  clips: S.clips.map(c => ({ name: c.name, duration: +c.duration.toFixed(3) })),
  jointNames: S.skeleton.map(b => b.name),
  source: file.split('/').pop()
};
const blockStr = `const IMPORTED_CHARACTER = ${JSON.stringify(payload)};`;
log(`  payload  ${(blockStr.length / 1024).toFixed(0)} KB of base64`);

if (flag('dry')) { log('--dry: nothing written'); process.exit(0); }
const html = readFileSync(HTML, 'utf8');
const B = '/* ===IMPORTED-CHARACTER-BEGIN=== */', E = '/* ===IMPORTED-CHARACTER-END=== */';
if (!html.includes(B)) throw new Error('no IMPORTED-CHARACTER block in ' + HTML);
const out = html.slice(0, html.indexOf(B) + B.length) + '\n' + blockStr + '\n' + html.slice(html.indexOf(E));
writeFileSync(HTML, out);
log(`wrote ${HTML} (${(out.length / 1024).toFixed(0)} KB)`);
