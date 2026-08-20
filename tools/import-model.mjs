#!/usr/bin/env node
/* Import an authored vehicle mesh into index.html.
     node tools/import-model.mjs assets/car.glb [options]
   Options:
     --tris=6000     body triangle budget      --wheel-tris=700
     --length=4.5    target length in metres   --up=y|z   --forward=+z|-z|+x|-x
     --flip          spin 180 degrees about the vertical axis
     --dry           report the fit, write nothing
   Writes a packed base64 blob into the IMPORTED-MODEL block of index.html.
   No dependencies. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseModel } from './parse-model.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: import-model.mjs <model.glb|model.obj> [--tris=N] [--flip]'); process.exit(1); }
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const flag = k => args.includes('--' + k);
const TRIS = +opt('tris', 6000), WTRIS = +opt('wheel-tris', 700);
const TARGET_LEN = +opt('length', 4.5);
const HTML = opt('html', 'index.html');

const WHEEL_RE = /(wheel|tyre|tire|rim)/i;
const log = (...a) => console.log(...a);

/* ---------------------------------------------------------------- load -- */
const model = parseModel(file);
if (!model.parts.length) throw new Error('no triangles found in ' + file);
const wheelParts = model.parts.filter(p => WHEEL_RE.test(p.name));
const bodyParts  = model.parts.filter(p => !WHEEL_RE.test(p.name));
const allTris = model.parts.reduce((n, p) => n + p.tris.length, 0);
log(`parsed ${model.parts.length} parts, ${allTris} triangles`);
log(`  wheel-named parts: ${wheelParts.length}` + (wheelParts.length ? ` (${wheelParts.reduce((n,p)=>n+p.tris.length,0)} tris)` : ' — wheels will not spin'));

/* --------------------------------------------------------- orientation -- */
const every = fn => { for (const p of model.parts) for (const t of p.tris) for (let i = 0; i < 3; i++) fn(t, i); };
const bbox = () => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  every((t, i) => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], t.p[i][a]); hi[a] = Math.max(hi[a], t.p[i][a]); } });
  return { lo, hi, size: hi.map((h, a) => h - lo[a]) };
};
const remap = fn => every((t, i) => { t.p[i] = fn(t.p[i]); if (t.n) t.n[i] = fn(t.n[i]); });

let b = bbox();
log(`  raw size  x=${b.size[0].toFixed(2)} y=${b.size[1].toFixed(2)} z=${b.size[2].toFixed(2)}`);

/* Orientation. Wheel objects are the strongest cue available: four of them sit
   at the corners of a horizontal rectangle, so the axis their centres vary
   least along is up, and the axis they vary most along is the wheelbase, which
   is forward. Fall back to bounding-box shape when the model has no named
   wheels. */
const centroid = tris => {
  const c = [0, 0, 0];
  let n = 0;
  for (const t of tris) for (const p of t.p) { c[0]+=p[0]; c[1]+=p[1]; c[2]+=p[2]; n++; }
  return c.map(v => v / n);
};
let upAxis, fwdAxis;
const upOpt = opt('up', null), fwdOpt = opt('forward', null);
if (wheelParts.length >= 3 && !upOpt && !fwdOpt) {
  const cs = wheelParts.map(p => centroid(p.tris));
  const range = [0, 1, 2].map(a => Math.max(...cs.map(c => c[a])) - Math.min(...cs.map(c => c[a])));
  upAxis = range.indexOf(Math.min(...range));
  const rest = [0, 1, 2].filter(a => a !== upAxis);
  fwdAxis = range[rest[0]] >= range[rest[1]] ? rest[0] : rest[1];
  log(`  wheel centres spread ${range.map(r => r.toFixed(2)).join(' / ')} -> up=${'xyz'[upAxis]} forward=${'xyz'[fwdAxis]}`);
} else {
  upAxis = upOpt ? 'xyz'.indexOf(upOpt) : (b.size[1] > b.size[0] && b.size[1] > b.size[2] ? 2 : 1);
  const rest = [0, 1, 2].filter(a => a !== upAxis);
  fwdAxis = fwdOpt ? 'xyz'.indexOf(fwdOpt.replace(/[+-]/, ''))
                   : (b.size[rest[0]] >= b.size[rest[1]] ? rest[0] : rest[1]);
  log(`  no wheel objects — from bounds: up=${'xyz'[upAxis]} forward=${'xyz'[fwdAxis]}`);
}
const sideAxis = [0, 1, 2].find(a => a !== upAxis && a !== fwdAxis);
/* keep the frame right-handed, or the model comes through mirrored */
const parity = (p => {
  let sw = 0;
  const q = [...p];
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (q[i] > q[j]) { [q[i], q[j]] = [q[j], q[i]]; sw++; }
  return sw % 2 ? -1 : 1;
})([sideAxis, upAxis, fwdAxis]);
if (!(upAxis === 1 && fwdAxis === 2 && parity === 1)) {
  remap(p => [p[sideAxis] * parity, p[upAxis], p[fwdAxis]]);
  log(`  remapped to y-up / z-forward (handedness ${parity > 0 ? 'kept' : 'corrected'})`);
}
b = bbox();

/* upside down? the wheels must sit below the body */
if (wheelParts.length) {
  const wy = centroid(wheelParts.flatMap(p => p.tris))[1];
  const by = centroid(bodyParts.flatMap(p => p.tris))[1];
  if (wy > by) { log('  wheels above body — rolling 180 degrees'); remap(p => [-p[0], -p[1], p[2]]); b = bbox(); }
}

/* which end is the front? the roof of a vehicle sits behind its centre, so the
   centroid of the highest slice leans towards the back. */
if (!flag('no-auto-front')) {
  const yTop = b.lo[1] + b.size[1] * 0.75;
  let zs = 0, n = 0;
  every((t, i) => { if (t.p[i][1] > yTop) { zs += t.p[i][2]; n++; } });
  const zc = n ? zs / n - (b.lo[2] + b.size[2] / 2) : 0;
  log(`  roof bias ${zc.toFixed(2)} m ${zc > 0 ? '-> front is -z, flipping' : '-> front is +z'}`);
  if (zc > 0) remap(p => [-p[0], p[1], -p[2]]);
}
if (fwdOpt && fwdOpt[0] === '-') remap(p => [-p[0], p[1], -p[2]]);
if (flag('flip')) { log('  --flip'); remap(p => [-p[0], p[1], -p[2]]); }
b = bbox();

/* ---------------------------------------------------- scale and centre -- */
const scale = TARGET_LEN / b.size[2];
remap(p => [p[0] * scale, p[1] * scale, p[2] * scale]);
b = bbox();

/* wheel clusters give the axle midpoint and the rolling radius */
let fit = null;
if (wheelParts.length) {
  const pts = [];
  for (const p of wheelParts) for (const t of p.tris) for (let i = 0; i < 3; i++) pts.push(t.p[i]);
  const cs = [[1,1],[-1,1],[1,-1],[-1,-1]].map(([sx, sz]) => {
    const sel = pts.filter(p => Math.sign(p[0] - (b.lo[0]+b.size[0]/2)) === sx && Math.sign(p[2] - (b.lo[2]+b.size[2]/2)) === sz);
    if (sel.length < 12) return null;
    const c = [0,1,2].map(a => sel.reduce((s,p)=>s+p[a],0)/sel.length);
    const r = Math.max(...sel.map(p => Math.hypot(p[1]-c[1], p[2]-c[2])));
    return { c, r, n: sel.length };
  }).filter(Boolean);
  if (cs.length >= 2) {
    fit = {
      mountX: +(cs.reduce((s,w)=>s+Math.abs(w.c[0]),0)/cs.length).toFixed(3),
      mountZ: +(cs.reduce((s,w)=>s+Math.abs(w.c[2]),0)/cs.length).toFixed(3),
      wheelR: +(cs.reduce((s,w)=>s+w.r,0)/cs.length).toFixed(3),
      count: cs.length
    };
    log(`  wheels: ${cs.length} clusters, track ±${fit.mountX} m, wheelbase ±${fit.mountZ} m, radius ${fit.wheelR} m`);
  }
}

/* centre on the axle midpoint (or the bbox), and sit the tyres on the engine's
   rest contact plane, which sits below the body origin by the suspension
   geometry plus the fitted wheel radius. */
const cx = b.lo[0] + b.size[0] / 2;
const cz = fit ? 0 : b.lo[2] + b.size[2] / 2;
const MOUNT_Y = 0.30, SUS_REST = 0.52, REST_COMP = 0.15;
const GROUND = MOUNT_Y - (SUS_REST + (fit ? fit.wheelR : 0.44)) + REST_COMP;
remap(p => [p[0] - cx, p[1] - b.lo[1] + GROUND, p[2] - cz]);
b = bbox();
log(`  fitted    x=${b.size[0].toFixed(2)} y=${b.size[1].toFixed(2)} z=${b.size[2].toFixed(2)} m`);

/* -------------------------------------------------------------- reduce -- */
function decimate(tris, budget) {
  if (tris.length <= budget) return tris;
  const lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9];
  for (const t of tris) for (const p of t.p) for (let a = 0; a < 3; a++) { lo[a]=Math.min(lo[a],p[a]); hi[a]=Math.max(hi[a],p[a]); }
  const diag = Math.hypot(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]);
  let lowN = 8, highN = 512, best = null;
  for (let iter = 0; iter < 14; iter++) {
    const N = Math.round((lowN + highN) / 2);
    const cell = diag / N;
    const key = p => `${Math.floor((p[0]-lo[0])/cell)},${Math.floor((p[1]-lo[1])/cell)},${Math.floor((p[2]-lo[2])/cell)}`;
    const rep = new Map();
    for (const t of tris) for (const p of t.p) {
      const k = key(p), r = rep.get(k);
      if (r) { r.s[0]+=p[0]; r.s[1]+=p[1]; r.s[2]+=p[2]; r.n++; }
      else rep.set(k, { s: [...p], n: 1 });
    }
    for (const r of rep.values()) r.p = r.s.map(v => v / r.n);
    const out = [];
    for (const t of tris) {
      const k = t.p.map(key);
      if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
      out.push({ p: k.map(kk => rep.get(kk).p), n: null, c: t.c });
    }
    if (!best || Math.abs(out.length - budget) < Math.abs(best.length - budget)) best = out;
    if (out.length > budget) highN = N; else lowN = N;
    if (highN - lowN <= 1) break;
  }
  return best;
}

/* --------------------------------------------------------------- pack --- */
function pack(tris) {
  let m = 0;
  for (const t of tris) for (const p of t.p) for (const v of p) m = Math.max(m, Math.abs(v));
  const s = m / 32000 || 1e-6;
  const buf = Buffer.alloc(12 + tris.length * 3 * 12);
  buf.write('SKM1', 0, 'ascii');
  buf.writeUInt32LE(tris.length, 4);
  buf.writeFloatLE(s, 8);
  let o = 12;
  for (const t of tris) {
    let n = t.n;
    if (!n) {
      const [a, bb, c] = t.p;
      const u = [bb[0]-a[0], bb[1]-a[1], bb[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      let fn = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const l = Math.hypot(...fn) || 1;
      fn = fn.map(x => x / l);
      n = [fn, fn, fn];
    }
    for (let i = 0; i < 3; i++) {
      for (let a = 0; a < 3; a++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(t.p[i][a] / s))), o + a * 2);
      const nl = Math.hypot(...n[i]) || 1;
      for (let a = 0; a < 3; a++) buf.writeInt8(Math.max(-127, Math.min(127, Math.round(n[i][a] / nl * 127))), o + 6 + a);
      for (let a = 0; a < 3; a++) buf.writeUInt8(Math.max(0, Math.min(255, Math.round((t.c[a] ?? 0.7) * 255))), o + 9 + a);
      o += 12;
    }
  }
  return buf.toString('base64');
}

const bodyTris = decimate(bodyParts.flatMap(p => p.tris), TRIS);
log(`  body   ${bodyParts.reduce((n,p)=>n+p.tris.length,0)} -> ${bodyTris.length} triangles`);

let wheelB64 = null;
if (wheelParts.length && fit) {
  /* one wheel, moved to the origin, so the engine can spin and steer it */
  const all = wheelParts.flatMap(p => p.tris);
  const pick = all.filter(t => t.p.every(p => p[0] > 0 && p[2] > 0));
  const src = pick.length > 20 ? pick : all;
  const c = [0, 1, 2].map(a => {
    const vs = src.flatMap(t => t.p.map(p => p[a]));
    return (Math.min(...vs) + Math.max(...vs)) / 2;
  });
  const centred = src.map(t => ({ p: t.p.map(p => [p[0]-c[0], p[1]-c[1], p[2]-c[2]]), n: null, c: t.c }));
  const w = decimate(centred, WTRIS);
  log(`  wheel  ${src.length} -> ${w.length} triangles`);
  wheelB64 = pack(w);
}

const payload = {
  body: pack(bodyTris),
  wheel: wheelB64,
  fit: fit ? { wheelR: fit.wheelR, mountX: fit.mountX, mountZ: fit.mountZ } : null,
  source: file.split('/').pop(),
  tris: bodyTris.length
};
const blockStr = `const IMPORTED = ${JSON.stringify(payload)};`;
log(`  payload ${(blockStr.length / 1024).toFixed(0)} KB of base64`);

if (flag('dry')) { log('--dry: nothing written'); process.exit(0); }

const html = readFileSync(HTML, 'utf8');
const B = '/* ===IMPORTED-MODEL-BEGIN=== */', E = '/* ===IMPORTED-MODEL-END=== */';
if (!html.includes(B)) throw new Error('no IMPORTED-MODEL block in ' + HTML);
const out = html.slice(0, html.indexOf(B) + B.length) + '\n' + blockStr + '\n' + html.slice(html.indexOf(E));
writeFileSync(HTML, out);
log(`wrote ${HTML} (${(out.length / 1024).toFixed(0)} KB)`);
