#!/usr/bin/env node
/* Import an authored prop mesh (rock, mesa, cliff, plant, anything you drive
   past or into) into index.html.

     node tools/import-prop.mjs assets/mesa_01.glb --name=mesa01 --height=18

   Options
     --name=ID          key in the prop table                       (required)
     --tris=600         triangle budget after decimation
     --height=18        scale so the mesh stands this tall, in metres;
                        omit to keep the authored scale
     --up=y|z           source up axis                              (default y)
     --yaw=90           spin about the vertical axis, degrees
     --kind=hard|soft   collision response                          (default hard)
     --scatter=rock|sand|both|none    where the world places it     (default both)
     --per-km2=40       density where it is placed
     --slope=14         steepest ground it will sit on, degrees
     --scale=1,1.6      instance scale range
     --clear=6          keep this many metres clear of the road
     --remove           delete this entry and write nothing else
     --dry              report the fit, write nothing

   The mesh needs per-vertex colour, not textures — this renderer has no
   texture pipeline at all. Bake the albedo down to a Color Attribute in
   Blender before exporting glTF and it comes through as COLOR_0. No
   dependencies. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseModel } from './parse-model.mjs';
import { decimate, pack } from './pack-mesh.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const flag = k => args.includes('--' + k);
const log = (...a) => console.log(...a);

const NAME = opt('name', null);
const HTML = opt('html', 'index.html');
const B = '/* ===IMPORTED-PROPS-BEGIN=== */', E = '/* ===IMPORTED-PROPS-END=== */';

if (!NAME) { console.error('usage: import-prop.mjs <model.glb> --name=ID [--height=M] [--tris=N]'); process.exit(1); }
if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(NAME)) throw new Error('--name must be a plain identifier: ' + NAME);

/* ------------------------------------------------- read the prop table -- */
function readTable(html) {
  const i = html.indexOf(B), j = html.indexOf(E);
  if (i < 0 || j < 0) throw new Error('no IMPORTED-PROPS block in ' + HTML);
  const body = html.slice(i + B.length, j);
  const m = body.match(/const\s+IMPORTED_PROPS\s*=\s*([\s\S]*?);\s*$/);
  return m ? JSON.parse(m[1]) : {};
}
function writeTable(html, table) {
  const i = html.indexOf(B), j = html.indexOf(E);
  return html.slice(0, i + B.length) + '\n' +
    `const IMPORTED_PROPS = ${JSON.stringify(table)};` + '\n' + html.slice(j);
}

let html = readFileSync(HTML, 'utf8');
const table = readTable(html);

if (flag('remove')) {
  if (!table[NAME]) { log(`no prop named ${NAME}`); process.exit(0); }
  delete table[NAME];
  writeFileSync(HTML, writeTable(html, table));
  log(`removed ${NAME}; ${Object.keys(table).length} prop(s) left`);
  process.exit(0);
}

const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('no model file given'); process.exit(1); }

const TRIS = +opt('tris', 600);
const HEIGHT = opt('height', null) === null ? null : +opt('height');
const YAW = +opt('yaw', 0) * Math.PI / 180;
const KIND = opt('kind', 'hard');
const SCATTER = opt('scatter', 'both');
const PER_KM2 = +opt('per-km2', 40);
const SLOPE = +opt('slope', 14);
const CLEAR = +opt('clear', 6);
const SCALE = opt('scale', '1,1.6').split(',').map(Number);
if (!['hard', 'soft'].includes(KIND)) throw new Error('--kind must be hard or soft');
if (!['rock', 'sand', 'both', 'none'].includes(SCATTER)) throw new Error('--scatter must be rock|sand|both|none');

/* ---------------------------------------------------------------- load -- */
const model = parseModel(file);
if (!model.parts.length) throw new Error('no triangles found in ' + file);
let tris = model.parts.flatMap(p => p.tris);
log(`${file}: ${model.parts.length} part(s), ${tris.length} triangles`);

const every = fn => { for (const t of tris) for (let i = 0; i < 3; i++) fn(t, i); };
const remap = fn => every((t, i) => { t.p[i] = fn(t.p[i]); if (t.n) t.n[i] = fn(t.n[i]); });

/* Blender's glTF exporter already writes Y-up, so that is the default; --up=z
   is for anything handed over in Blender's own axis convention. */
if (opt('up', 'y') === 'z') remap(p => [p[0], p[2], -p[1]]);
if (YAW) { const c = Math.cos(YAW), s = Math.sin(YAW); remap(p => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]); }

const points = () => tris.flatMap(t => t.p);
const box = () => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of points()) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  return { lo, hi };
};

/* A prop is placed by its footprint and stands on the ground, so the origin
   goes at the centre of the base rather than at the centre of the volume —
   otherwise every rock has to be nudged by hand once it is in the world. */
{
  const { lo, hi } = box();
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  remap(p => [p[0] - cx, p[1] - lo[1], p[2] - cz]);
}
if (HEIGHT) {
  const { hi } = box();
  const k = HEIGHT / (hi[1] || 1);
  remap(p => [p[0] * k, p[1] * k, p[2] * k]);
  log(`  scaled x${k.toFixed(3)} to stand ${HEIGHT} m tall`);
}

const { lo, hi } = box();
log(`  extents  x=${(hi[0] - lo[0]).toFixed(2)} y=${hi[1].toFixed(2)} z=${(hi[2] - lo[2]).toFixed(2)} m`);

/* ------------------------------------------------------------- normals -- */
/* Flipped normals are the commonest thing wrong with an exported mesh, and
   they fail quietly: the surface just renders ambient-only and the prop looks
   like a grey cut-out. Everything here is flat-shaded anyway, so the default is
   to rebuild face normals from the winding and point them away from the
   centroid, which is right whatever the DCC tool did. --normals=keep for a
   mesh whose authored normals actually matter. */
const NORMALS = opt('normals', 'rebuild');
function outwardness(ts) {
  const c = [0, 0, 0];
  let n = 0;
  for (const t of ts) for (const p of t.p) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++; }
  for (let a = 0; a < 3; a++) c[a] /= n || 1;
  let sum = 0, cnt = 0;
  for (const t of ts) {
    if (!t.n) continue;
    for (let i = 0; i < 3; i++) {
      const d = [t.p[i][0] - c[0], t.p[i][1] - c[1], t.p[i][2] - c[2]];
      const l = Math.hypot(...d);
      if (l < 1e-3) continue;
      const nl = Math.hypot(...t.n[i]) || 1;
      sum += (d[0] * t.n[i][0] + d[1] * t.n[i][1] + d[2] * t.n[i][2]) / (l * nl);
      cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}
{
  const before = outwardness(tris);
  if (NORMALS === 'rebuild') {
    const c = [0, 0, 0];
    let n = 0;
    for (const t of tris) for (const p of t.p) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++; }
    for (let a = 0; a < 3; a++) c[a] /= n || 1;
    let flipped = 0;
    for (const t of tris) {
      const [a, b2, c2] = t.p;
      const u = [b2[0]-a[0], b2[1]-a[1], b2[2]-a[2]], v = [c2[0]-a[0], c2[1]-a[1], c2[2]-a[2]];
      let fn = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const l = Math.hypot(...fn) || 1;
      fn = fn.map(x => x / l);
      const m = [(a[0]+b2[0]+c2[0])/3 - c[0], (a[1]+b2[1]+c2[1])/3 - c[1], (a[2]+b2[2]+c2[2])/3 - c[2]];
      if (fn[0]*m[0] + fn[1]*m[1] + fn[2]*m[2] < 0) { fn = fn.map(x => -x); flipped++; }
      t.n = [fn, fn, fn];
    }
    log(`  normals  rebuilt from winding, ${flipped}/${tris.length} pointed inward and were turned`);
  } else if (NORMALS === 'flip') {
    for (const t of tris) if (t.n) t.n = t.n.map(v => v.map(x => -x));
    log('  normals  flipped');
  }
  const after = outwardness(tris);
  log(`  normals  outwardness ${before.toFixed(2)} -> ${after.toFixed(2)}` +
      (after < 0.25 ? '   *** still low: this mesh will light badly, check it in the viewer ***' : ''));
}

/* -------------------------------------------------------------- albedo -- */
/* The prop shader adds a flat sky term on top of the albedo-modulated light,
   which is what stops unlit sides going pure black. The side effect is that a
   dark mesh drifts blue: below about 0.30 mean luminance that additive term
   starts to dominate and a brown rock renders slate. Baked photogrammetry
   albedo is usually well under that, so --albedo normalises the mean and
   leaves the variation alone. */
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const meanAlbedo = () => {
  let s = [0, 0, 0], n = 0;
  for (const t of tris) { for (let a = 0; a < 3; a++) s[a] += (t.c?.[a] ?? 0.7); n++; }
  return s.map(v => v / (n || 1));
};
{
  const before = meanAlbedo();
  const want = opt('albedo', null);
  if (want !== null) {
    const k = +want / (lum(before) || 1e-6);
    for (const t of tris) if (t.c) t.c = t.c.map(v => Math.min(1, v * k));
    log(`  albedo   mean luminance ${lum(before).toFixed(3)} -> ${lum(meanAlbedo()).toFixed(3)} (x${k.toFixed(2)})`);
  } else {
    const l = lum(before);
    log(`  albedo   mean luminance ${l.toFixed(3)}` +
        (l < 0.30 ? `   *** dark: the flat sky term will push this towards blue, try --albedo=0.45 ***` : ''));
  }
}

/* ------------------------------------------------------------ collider -- */
/* Stack of spheres up the vertical axis. The car is an oriented box and
   box-vs-sphere gives an exact closest point, depth and normal, so a few
   spheres is all the impulse solver wants — and a percentile radius rather
   than the maximum stops one stray spur inflating the whole hull. */
function fitSpheres(ts, bands) {
  const pts = ts.flatMap(t => t.p);
  const top = Math.max(...pts.map(p => p[1])) || 1;
  const out = [];
  for (let b = 0; b < bands; b++) {
    const y0 = top * b / bands, y1 = top * (b + 1) / bands;
    const inBand = pts.filter(p => p[1] >= y0 && p[1] <= y1);
    if (inBand.length < 6) continue;
    let cx = 0, cz = 0;
    for (const p of inBand) { cx += p[0]; cz += p[2]; }
    cx /= inBand.length; cz /= inBand.length;
    const rs = inBand.map(p => Math.hypot(p[0] - cx, p[2] - cz)).sort((a, b2) => a - b2);
    const r = rs[Math.floor(rs.length * 0.90)];
    const half = (y1 - y0) / 2;
    out.push({ x: +cx.toFixed(3), y: +((y0 + y1) / 2).toFixed(3), z: +cz.toFixed(3),
               r: +Math.max(r, half * 0.75).toFixed(3) });
  }
  /* drop any band the one below already swallows */
  return out.filter((s, i) => !out.some((o, j) =>
    j !== i && Math.hypot(o.x - s.x, o.y - s.y, o.z - s.z) + s.r <= o.r * 1.02));
}
const spheres = fitSpheres(tris, 3);
log(`  collider ${spheres.length} sphere(s): ${spheres.map(s => `r=${s.r}@y${s.y}`).join(' ')}`);

/* ------------------------------------------------------------- reduce --- */
const before = tris.length;
tris = decimate(tris, TRIS);
log(`  mesh     ${before} -> ${tris.length} triangles`);

const entry = {
  mesh: pack(tris),
  tris: tris.length,
  spheres,
  kind: KIND,
  scatter: SCATTER,
  perKm2: PER_KM2,
  maxSlope: SLOPE,
  scale: [SCALE[0], SCALE[1] ?? SCALE[0]],
  roadClear: CLEAR,
  height: +hi[1].toFixed(2),
  source: file.split('/').pop()
};
table[NAME] = entry;

const blockStr = `const IMPORTED_PROPS = ${JSON.stringify(table)};`;
log(`  payload  ${(JSON.stringify(entry).length / 1024).toFixed(0)} KB for ${NAME}` +
    `; table now ${(blockStr.length / 1024).toFixed(0)} KB, ${Object.keys(table).length} prop(s)`);

if (flag('dry')) { log('--dry: nothing written'); process.exit(0); }
writeFileSync(HTML, writeTable(html, table));
log(`wrote ${HTML}`);
