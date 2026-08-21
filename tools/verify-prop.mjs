#!/usr/bin/env node
/* Render every imported prop straight out of index.html, as a contact sheet.

     node tools/verify-prop.mjs                     # all of them
     node tools/verify-prop.mjs --only=mesaA,stoneBigA
     node tools/verify-prop.mjs --colliders=0 --out=props.png

   The prop importer is the one path with no verifier, and it is the path with
   the most ways to be quietly wrong: an inverted winding renders as a grey
   cut-out, a dark bake drifts blue, and a badly fitted collider is an
   invisible wall. So this decodes the SKM1 blobs the game will actually
   upload — not the source mesh — flat-shades them with the sun direction the
   prop shader uses, and draws the fitted collider spheres over the top.

   The number that matters most is printed rather than drawn. `pack()` derives
   every face normal from the triangle winding, so if a mesh arrives wound
   inside out the whole prop lights from behind and nothing upstream notices.
   Outwardness is the mean of normal·(centroid→face), which is near 1 for a
   convex shape wound correctly and negative for one wound inside out; a lumpy
   rock sits around 0.5 and a flat slab lower, so it is read as a sign test,
   not a score.

   Needs playwright for the canvas. No other dependency. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const HTML = opt('html', 'index.html');
const OUT = opt('out', 'props.png');
const CELL = +opt('px', 320);
const COLS = +opt('cols', 4);
const SHOW_COLLIDERS = opt('colliders', '1') !== '0';
const ONLY = opt('only', null);

const html = readFileSync(HTML, 'utf8');
const m = html.match(/const IMPORTED_PROPS = (\{[\s\S]*?\});\n/);
if (!m) throw new Error('no IMPORTED-PROPS block in ' + HTML);
const table = JSON.parse(m[1]);
let names = Object.keys(table);
if (ONLY) names = names.filter(n => ONLY.split(',').includes(n));
if (!names.length) { console.log('no props imported' + (ONLY ? ' matching --only' : '')); process.exit(0); }

const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

const cards = [], fail = [], rows = [];
for (const name of names) {
  const d = table[name];
  let buf = Buffer.from(d.mesh, 'base64');
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  if (gz) buf = gunzipSync(buf);
  if (buf.toString('ascii', 0, 4) !== 'SKM1') { fail.push(`${name}: bad blob`); continue; }
  const n = buf.readUInt32LE(4), s = buf.readFloatLE(8);

  const tris = [];
  for (let i = 0, o = 12; i < n; i++) {
    const p = [], nr = [], c = [];
    for (let k = 0; k < 3; k++, o += 12) {
      p.push([buf.readInt16LE(o) * s, buf.readInt16LE(o + 2) * s, buf.readInt16LE(o + 4) * s]);
      nr.push([buf.readInt8(o + 6) / 127, buf.readInt8(o + 7) / 127, buf.readInt8(o + 8) / 127]);
      c.push([buf[o + 9] / 255, buf[o + 10] / 255, buf[o + 11] / 255]);
    }
    tris.push({ p, nr: nr[0], c: c[0] });
  }

  /* measurements, off the shipped bytes */
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of tris) for (const p of t.p) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  const cen = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let out = 0, meanL = 0, minL = 1, maxL = 0;
  for (const t of tris) {
    const fc = [0, 1, 2].map(a => (t.p[0][a] + t.p[1][a] + t.p[2][a]) / 3 - cen[a]);
    const fl = Math.hypot(...fc) || 1;
    out += (fc[0] * t.nr[0] + fc[1] * t.nr[1] + fc[2] * t.nr[2]) / fl;
    const l = lum(t.c);
    meanL += l; if (l < minL) minL = l; if (l > maxL) maxL = l;
  }
  out /= tris.length || 1; meanL /= tris.length || 1;

  /* how much of the mesh the collider hull actually contains */
  const sph = d.spheres || [];
  let inside = 0, pts = 0;
  for (const t of tris) for (const p of t.p) {
    pts++;
    if (sph.some(q => Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z) <= q.r)) inside++;
  }
  const cover = pts ? inside / pts : 0;
  /* and how far past the mesh the hull bulges — an invisible kerb */
  let bulge = 0;
  for (const q of sph) bulge = Math.max(bulge, q.y + q.r - hi[1]);

  rows.push({ prop: name, tris: n, m: `${(hi[0]-lo[0]).toFixed(1)}x${hi[1].toFixed(1)}x${(hi[2]-lo[2]).toFixed(1)}`,
              kb: +(d.mesh.length / 1024).toFixed(1), gz: gz ? 'y' : '', out: +out.toFixed(2),
              lum: +meanL.toFixed(3), spread: `${minL.toFixed(2)}-${maxL.toFixed(2)}`,
              sph: sph.length, cover: +(cover * 100).toFixed(0), bulge: +bulge.toFixed(2) });

  if (out < 0) fail.push(`${name}: outwardness ${out.toFixed(2)} — this mesh is wound inside out and will light from behind`);
  if (meanL < 0.06) fail.push(`${name}: mean luminance ${meanL.toFixed(3)} — the flat sky term will swamp this and it will render blue`);
  if (sph.length && cover < 0.25) fail.push(`${name}: colliders contain only ${(cover * 100) | 0}% of the mesh — you will drive through it`);
  if (bulge > Math.max(0.4, hi[1] * 0.18)) fail.push(`${name}: colliders stand ${bulge.toFixed(2)} m proud of the mesh — an invisible kerb`);

  cards.push({ name, tris, sph, lo, hi, label: `${name}  ${n}t  ${hi[1].toFixed(1)}m  L${meanL.toFixed(2)}  ${sph.length}s` });
}

console.table(rows);

const ROWS = Math.ceil(cards.length / COLS);
const W = CELL * Math.min(COLS, cards.length), H = CELL * ROWS;
const { chromium } = await import('playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
await page.setContent('<body style="margin:0;background:#3d4a56"></body>');
await page.evaluate(({ cards, CELL, COLS, W, H, SHOW_COLLIDERS }) => {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H; document.body.appendChild(cv);
  const g = cv.getContext('2d');
  /* the game's key light, roughly: a high afternoon sun off to one side */
  const sun = [-0.42, 0.66, 0.62];
  /* a three-quarter view, so a silhouette and a face are both visible */
  const YAW = 32 * Math.PI / 180, PITCH = 17 * Math.PI / 180;
  const proj = p => {
    const cy = Math.cos(YAW), sy = Math.sin(YAW);
    const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy;
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    return [x, p[1] * cp - z * sp, p[1] * sp + z * cp];
  };
  cards.forEach((card, i) => {
    const col = i % COLS, row = (i / COLS) | 0;
    const ox = col * CELL, oy = row * CELL;
    g.save();
    g.beginPath(); g.rect(ox, oy, CELL, CELL); g.clip();
    const grd = g.createLinearGradient(0, oy, 0, oy + CELL);
    grd.addColorStop(0, '#5d7285'); grd.addColorStop(1, '#8a7a63');
    g.fillStyle = grd; g.fillRect(ox, oy, CELL, CELL);

    const size = Math.max(card.hi[0] - card.lo[0], card.hi[2] - card.lo[2], card.hi[1]) || 1;
    const scale = CELL * 0.62 / size;
    const cx = ox + CELL / 2, cy = oy + CELL * 0.62;
    const at = p => { const q = proj([p[0], p[1], p[2]]); return [cx + q[0] * scale, cy - q[1] * scale]; };

    /* ground line, so a prop that floats or buries itself is obvious */
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(ox, cy); g.lineTo(ox + CELL, cy); g.stroke();

    const ts = card.tris.slice().sort((a, c) => proj(a.p[0])[2] - proj(c.p[0])[2]);
    for (const t of ts) {
      const nl = Math.hypot(...t.nr) || 1;
      const d = Math.max(0, (t.nr[0] * sun[0] + t.nr[1] * sun[1] + t.nr[2] * sun[2]) / nl);
      /* the prop shader's flat sky term, which is what a dark bake drowns in */
      const sh = 0.34 + 0.95 * d;
      const c = t.c;
      g.fillStyle = `rgb(${Math.min(255, c[0] * 255 * sh) | 0},${Math.min(255, c[1] * 255 * sh) | 0},${Math.min(255, c[2] * 255 * sh) | 0})`;
      const a = at(t.p[0]), b2 = at(t.p[1]), c2 = at(t.p[2]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.lineTo(c2[0], c2[1]); g.closePath(); g.fill();
    }
    if (SHOW_COLLIDERS) {
      g.strokeStyle = 'rgba(80,255,190,0.85)'; g.lineWidth = 1.4;
      for (const s of card.sph) {
        const c0 = at([s.x, s.y, s.z]);
        g.beginPath(); g.arc(c0[0], c0[1], s.r * scale, 0, 6.2832); g.stroke();
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(ox, oy + CELL - 22, CELL, 22);
    g.fillStyle = '#dfe6ec'; g.font = '13px ui-monospace,Menlo,monospace';
    g.fillText(card.label, ox + 8, oy + CELL - 7);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.strokeRect(ox + 0.5, oy + 0.5, CELL - 1, CELL - 1);
  });
}, { cards, CELL, COLS, W, H, SHOW_COLLIDERS });
await page.screenshot({ path: OUT });
await b.close();

console.log(fail.length ? 'FAIL\n  ' + fail.join('\n  ') : `OK — ${cards.length} prop(s)`);
console.log('wrote ' + OUT + ' — now LOOK at it: green circles are the colliders');
process.exit(fail.length ? 1 : 0);
