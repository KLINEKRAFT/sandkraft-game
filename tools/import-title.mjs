#!/usr/bin/env node
/* Import the 3D wordmark into index.html.

     node tools/import-title.mjs assets/bronco_roam_title.glb --tris=3000

   Options
     --tris=N        triangle budget; omit to keep every triangle
     --width=6       scale so the wordmark is this wide, in metres
     --albedo=0.42   scale the colours so the brightest material lands here
     --face=r,g,b    colour for a material with no baseColorFactor
     --gap=0.015     word space, as a fraction of the width
     --no-gzip       store the blob uncompressed
     --dry           report the fit, write nothing
     --remove        delete the block and write nothing else

   Three things differ from the prop importer, and all of them come from this
   being extruded text rather than a rock.

   Node transforms are ignored. The wordmark's object rotation in the source
   is the tilt the artist framed the cover render at, and baking it in would
   leave the engine with no upright rest pose to animate a drop-in from. So
   the mesh is read in its own space, which is where the letters sit flat.

   Nothing is decimated by default, because a triangle budget here is a
   legibility question rather than a silhouette one. Vertex clustering pulls
   the boundary of a letter inward wherever the outline curves tighter than a
   cell, so counters fill in and the crowns go lumpy well before the shape
   degrades anywhere a budget would notice; at 3,000 triangles this wordmark
   is still readable but no longer the drawing that was authored. Compression
   is the better trade — it costs the letterforms nothing — and gzip takes
   this mesh 4.1x down, which beats what decimating to a quarter would have
   saved. --tris and its boundary-movement report are still there if a much
   heavier wordmark ever needs both.

   And the triangles come back sorted into word groups, so the engine can
   stagger them the way a set-in-HTML wordmark staggers its spans. No
   dependencies beyond Node's own zlib. */
import { readFileSync, writeFileSync } from 'node:fs';
import { readGLTFContainer, makeAccessorReader } from './parse-model.mjs';
import { decimate, pack } from './pack-mesh.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const flag = k => args.includes('--' + k);
const log = (...a) => console.log(...a);

const HTML = opt('html', 'index.html');
const B = '/* ===IMPORTED-TITLE-BEGIN=== */', E = '/* ===IMPORTED-TITLE-END=== */';
const write = (html, body) => {
  const i = html.indexOf(B), j = html.indexOf(E);
  if (i < 0 || j < 0) throw new Error('no IMPORTED-TITLE block in ' + HTML);
  return html.slice(0, i + B.length) + '\n' + body + '\n' + html.slice(j);
};

let html = readFileSync(HTML, 'utf8');
if (flag('remove')) {
  writeFileSync(HTML, write(html, 'const IMPORTED_TITLE = null;'));
  log('removed the imported title');
  process.exit(0);
}

const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: import-title.mjs <title.glb> [--tris=N] [--width=M]'); process.exit(1); }

/* ------------------------------------------------------------- read --- */
const { json, buffers } = readGLTFContainer(file);
const read = makeAccessorReader(json, buffers);

const meshNodes = json.nodes.filter(n => n.mesh !== undefined);
if (meshNodes.length !== 1)
  throw new Error(`expected one mesh node, found ${meshNodes.length} — join the wordmark into a single object`);
const node = meshNodes[0];
if (node.rotation || node.translation || node.scale)
  log(`ignoring the node transform (t=${JSON.stringify(node.translation || [0, 0, 0])} ` +
      `r=${JSON.stringify((node.rotation || [0, 0, 0, 1]).map(v => +v.toFixed(3)))}) — ` +
      'the wordmark is imported upright so the engine owns the pose');

const FACE = (opt('face', null) || '').split(',').filter(Boolean).map(Number);
const mesh = json.meshes[node.mesh];
let tris = [];
const mats = [];
for (const prim of mesh.primitives) {
  if (prim.mode !== undefined && prim.mode !== 4) continue;
  const P = read(prim.attributes.POSITION);
  const N = prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) : null;
  const idx = prim.indices !== undefined ? read(prim.indices)
                                         : { length: P.length / 3, __seq: true };
  const at = i => (idx.__seq ? i : idx[i]);
  const m = prim.material !== undefined ? json.materials[prim.material] : null;
  const f = m && m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor;
  const c = f ? [f[0], f[1], f[2]] : (FACE.length === 3 ? FACE : [0.86, 0.83, 0.76]);
  mats.push({ name: (m && m.name) || 'material', col: c, untinted: !f, tris: idx.length / 3 });
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const t = [at(i), at(i + 1), at(i + 2)];
    tris.push({
      p: t.map(v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]),
      n: N ? t.map(v => [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]) : null,
      c
    });
  }
}
log(`${mesh.name || 'mesh'}: ${tris.length} triangles across ${mats.length} material(s)`);
for (const m of mats)
  log(`  ${m.name.padEnd(12)} ${String(m.tris).padStart(5)} tris  ` +
      `rgb ${m.col.map(v => v.toFixed(3)).join(' ')}${m.untinted ? '  (no baseColorFactor — defaulted)' : ''}`);

/* --------------------------------------------------------- normalise --- */
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (const t of tris) for (const p of t.p) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
log(`authored ${size.map(v => v.toFixed(3)).join(' x ')} m`);
if (size[2] > size[1])
  log('  *** the wordmark is deeper than it is tall — check it was extruded along Z ***');

/* Centre on the glyph box and scale to the requested width. The engine places
   the wordmark by its centre, so an off-centre origin would show up as the
   title drifting sideways as it scales in. */
const WIDTH = +opt('width', 6);
const k = WIDTH / size[0];
const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
for (const t of tris) for (const p of t.p) for (let a = 0; a < 3; a++) p[a] = (p[a] - mid[a]) * k;

/* ------------------------------------------------------------ colour --- */
const ALB = opt('albedo', null);
if (ALB !== null) {
  let peak = 0;
  for (const t of tris) peak = Math.max(peak, (t.c[0] * 0.299 + t.c[1] * 0.587 + t.c[2] * 0.114));
  const s = +ALB / (peak || 1);
  const seen = new Map();
  for (const t of tris) {
    let c = seen.get(t.c);
    if (!c) { c = t.c.map(v => Math.min(1, v * s)); seen.set(t.c, c); }
    t.c = c;
  }
  log(`albedo: brightest material ${peak.toFixed(3)} -> ${(+ALB).toFixed(3)} (x${s.toFixed(3)})`);
}

/* --------------------------------------------------------- decimate --- */
const BUDGET = +opt('tris', Infinity);
/* The front face is the letterform, so measure the damage there: how far the
   silhouette of the flat cap moved, against the thinnest stroke it has. */
const capZ = hi[2] - mid[2];
const capOf = (list) => {
  const pts = [];
  for (const t of list) for (const p of t.p) if (Math.abs(p[2] - capZ * k) < 1e-3 * WIDTH) pts.push(p);
  return pts;
};
const before = capOf(tris);
const reduced = decimate(tris, BUDGET);
const after = capOf(reduced);
if (before.length && after.length) {
  /* nearest surviving cap point for each original one — clustering only ever
     moves a vertex within its own cell, so this is the actual displacement */
  let worst = 0, sum = 0;
  const step = Math.max(1, Math.floor(before.length / 4000));
  let n = 0;
  for (let i = 0; i < before.length; i += step) {
    const p = before[i];
    let d = 1e9;
    for (const q of after) { const e = Math.hypot(q[0] - p[0], q[1] - p[1]); if (e < d) d = e; }
    worst = Math.max(worst, d); sum += d; n++;
  }
  log(`decimated ${tris.length} -> ${reduced.length} triangles; ` +
      `letter boundary moved ${(sum / n * 1000).toFixed(1)} mm mean, ${(worst * 1000).toFixed(1)} mm worst ` +
      `(cap is ${(size[1] * k).toFixed(2)} m tall)`);
} else {
  log(`decimated ${tris.length} -> ${reduced.length} triangles`);
}

/* ------------------------------------------------------------ words --- */
/* Split at the word spaces, so the engine can stagger them the way the CSS
   wordmark it replaces staggered its two spans. A space is a gap in the
   occupied X range wider than any gap between letters — sort the triangles by
   their leftmost X, sweep, and cut wherever the covered run breaks by more
   than a threshold. Reported, because a wordmark with tight tracking or a
   ligature bridging the gap comes back as one group and the stagger would
   then silently do nothing. */
const GAP = +opt('gap', 0.015) * WIDTH;
const lx = t => Math.min(t.p[0][0], t.p[1][0], t.p[2][0]);
const rx = t => Math.max(t.p[0][0], t.p[1][0], t.p[2][0]);
reduced.sort((a, b) => lx(a) - lx(b));
const words = [];
let reach = -1e9;
for (const t of reduced) {
  if (!words.length || lx(t) - reach > GAP) words.push({ tris: [], lo: lx(t), hi: rx(t) });
  const w = words[words.length - 1];
  w.tris.push(t); w.hi = Math.max(w.hi, rx(t));
  reach = Math.max(reach, rx(t));
}
log(`${words.length} word group(s): ` + words.map(w =>
  `${w.tris.length} tris over ${w.lo.toFixed(2)}..${w.hi.toFixed(2)} m`).join(', '));
if (words.length === 1) log('  (one group — the wordmark will drop as a single piece)');

/* Each group's own centre, so the engine can pivot a word about itself rather
   than about the whole wordmark, which would swing the outer words on an arc. */
const ordered = words.flatMap(w => w.tris);
const meta = {
  tris: ordered.length,
  width: +WIDTH.toFixed(4),
  height: +(size[1] * k).toFixed(4),
  depth: +(size[2] * k).toFixed(4),
  words: words.map(w => ({ n: w.tris.length, x: +((w.lo + w.hi) / 2).toFixed(4) })),
  source: file.split('/').pop(),
  data: pack(ordered, { gzip: !flag('no-gzip') })
};
const raw = ordered.length * 36 + 12;
log(`payload ${(meta.data.length / 1024).toFixed(0)} KB base64` +
    (flag('no-gzip') ? '' : ` (gzip ${(raw / 1024).toFixed(0)} KB -> ` +
      `${(Buffer.from(meta.data, 'base64').length / 1024).toFixed(0)} KB, ` +
      `${(raw / Buffer.from(meta.data, 'base64').length).toFixed(1)}x)`));

if (flag('dry')) { log('--dry: nothing written'); process.exit(0); }
writeFileSync(HTML, write(html, `const IMPORTED_TITLE = ${JSON.stringify(meta)};`));
log(`wrote ${HTML} — ${(readFileSync(HTML).length / 1024).toFixed(0)} KB`);
