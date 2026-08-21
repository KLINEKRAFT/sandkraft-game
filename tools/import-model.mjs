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
import { decimate, pack } from './pack-mesh.mjs';

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

/* --as-is: the model was already authored in the engine's body space
   (+Z forward, +Y up, origin at the axle midpoint over the rest contact
   plane). Fitting it would only move it off the marks it was built to. */
const AS_IS = flag('as-is');
if (AS_IS) log('  --as-is: taking the geometry verbatim, no reorient/scale/centre');

/* Orientation. Wheel objects are the strongest cue available: four of them sit
   at the corners of a horizontal rectangle, so the axis their centres vary
   least along is up, and the axis they vary most along is the wheelbase, which
   is forward. Fall back to bounding-box shape when the model has no named
   wheels. */
if (!AS_IS) {
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
}

/* ---------------------------------------------------- scale and centre -- */
let fit = null;
const bboxOf = tris => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of tris) for (const p of t.p) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  return { lo, hi, size: hi.map((h, a) => h - lo[a]) };
};

if (AS_IS) {
  /* trust the author: only read the suspension numbers back off the mesh */
  const wb = wheelParts.length ? bboxOf(wheelParts.flatMap(p => p.tris)) : null;
  const wheelR = wb ? +(Math.max(wb.size[1], wb.size[2]) / 2).toFixed(3) : 0.44;
  fit = {
    wheelR,
    mountX: +((opt('track', null) ? +opt('track') / 2 : 0.80)).toFixed(3),
    mountZ: +((opt('wheelbase', null) ? +opt('wheelbase') / 2 : 1.475)).toFixed(3)
  };
  log(`  suspension: track ±${fit.mountX} m, wheelbase ±${fit.mountZ} m, wheel radius ${fit.wheelR} m`);
  b = bbox();
  log(`  extents   x=${b.size[0].toFixed(2)} y=${b.size[1].toFixed(2)} z=${b.size[2].toFixed(2)} m, ` +
      `body sits ${(b.lo[1] + 0.49).toFixed(2)} m over the ground plane`);
} else {
  const scale = TARGET_LEN / b.size[2];
  remap(p => [p[0] * scale, p[1] * scale, p[2] * scale]);
  b = bbox();

  /* wheel clusters give the axle midpoint and the rolling radius */
  if (wheelParts.length) {
    const pts = [];
    for (const p of wheelParts) for (const t of p.tris) for (let i = 0; i < 3; i++) pts.push(t.p[i]);
    const mid = [b.lo[0] + b.size[0] / 2, 0, b.lo[2] + b.size[2] / 2];
    const cs = [[1,1],[-1,1],[1,-1],[-1,-1]].map(([sx, sz]) => {
      const sel = pts.filter(p => Math.sign(p[0] - mid[0]) === sx && Math.sign(p[2] - mid[2]) === sz);
      if (sel.length < 12) return null;
      const c = [0,1,2].map(a => sel.reduce((s2,p)=>s2+p[a],0)/sel.length);
      const r = Math.max(...sel.map(p => Math.hypot(p[1]-c[1], p[2]-c[2])));
      return { c, r };
    }).filter(Boolean);
    if (cs.length >= 2) {
      fit = {
        mountX: +(cs.reduce((s2,w)=>s2+Math.abs(w.c[0]),0)/cs.length).toFixed(3),
        mountZ: +(cs.reduce((s2,w)=>s2+Math.abs(w.c[2]),0)/cs.length).toFixed(3),
        wheelR: +(cs.reduce((s2,w)=>s2+w.r,0)/cs.length).toFixed(3)
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
}

const bodyTris = decimate(bodyParts.flatMap(p => p.tris), TRIS);
log(`  body   ${bodyParts.reduce((n,p)=>n+p.tris.length,0)} -> ${bodyTris.length} triangles`);

let wheelB64 = null;
if (wheelParts.length && fit) {
  /* one wheel, moved to the origin, so the engine can spin and steer it */
  const all = wheelParts.flatMap(p => p.tris);
  if (AS_IS) {
    const w = decimate(all, WTRIS);
    log(`  wheel  ${all.length} -> ${w.length} triangles (already on its own axle)`);
    wheelB64 = pack(w);
  } else {
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
