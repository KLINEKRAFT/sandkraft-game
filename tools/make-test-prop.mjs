#!/usr/bin/env node
/* Write a test prop as GLB with per-vertex colour, so the whole authored-prop
   path can be exercised without an authored asset:

     node tools/make-test-prop.mjs /tmp/mesa
     node tools/import-prop.mjs /tmp/mesa.glb --name=testmesa --height=14

   The shape is a stepped, tapering rock stack — not art, but it has the things
   that matter for the importer: an off-centre footprint, a base that is not at
   y=0, and vertex colours rather than textures.

   Its normals point the wrong way, and that is deliberate. Flipped normals are
   the commonest defect in a mesh exported from someone else's tool and they
   fail silently — the surface renders ambient-only and the prop looks like a
   grey cut-out — so the fixture reproduces the failure the importer has to
   catch. Import it with --normals=keep to see what that looks like.
   No dependencies. */
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'test-prop';
const SEED = +(process.argv[3] || 7);
let hs = SEED;
const rnd = () => {
  hs = (hs * 1103515245 + 12345) & 0x7fffffff;
  return hs / 0x7fffffff;
};

const pos = [], nrm = [], col = [];
const tri = (a, b, c, rgb) => {
  const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
  for (const p of [a, b, c]) { pos.push(...p); nrm.push(...n); col.push(...rgb); }
};

/* a stack of tapering rings, jittered, deliberately offset from the origin */
const OFFX = 3.1, OFFZ = -1.7, BASEY = 2.4;      /* the importer must remove these */
const LEVELS = 7, SEG = 11;
const ring = (y, r) => {
  const pts = [];
  for (let i = 0; i < SEG; i++) {
    const th = 2 * Math.PI * i / SEG;
    const rr = r * (0.80 + rnd() * 0.42);
    pts.push([OFFX + Math.cos(th) * rr, BASEY + y, OFFZ + Math.sin(th) * rr]);
  }
  return pts;
};
let prev = ring(0, 3.0), prevY = 0;
const shade = t => {
  const s = 0.30 + t * 0.26;                      /* paler towards the cap */
  return [s * 0.86, s * 0.60, s * 0.42];
};
for (let L = 1; L <= LEVELS; L++) {
  const t = L / LEVELS;
  const y = prevY + 0.9 + rnd() * 0.5;
  const cur = ring(y, 3.0 * (1 - t * 0.62));
  const rgb = shade(t);
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    tri(prev[i], cur[j], cur[i], rgb);
    tri(prev[i], prev[j], cur[j], rgb);
  }
  prev = cur; prevY = y;
}
/* cap and floor */
const capC = [OFFX, BASEY + prevY + 0.5, OFFZ], capRgb = shade(1.05);
const botC = [OFFX, BASEY, OFFZ], botRgb = shade(0);
const base = ring(0, 3.0);
for (let i = 0; i < SEG; i++) {
  const j = (i + 1) % SEG;
  tri(prev[i], prev[j], capC, capRgb);
  tri(base[j], base[i], botC, botRgb);
}

/* ------------------------------------------------------------------ GLB -- */
const f32 = a => Buffer.from(new Float32Array(a).buffer);
const pB = f32(pos), nB = f32(nrm), cB = f32(col);
const pad4 = b => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4)]) : b;
const bin = pad4(Buffer.concat([pB, nB, cB]));
const count = pos.length / 3;
const minMax = (arr, n) => {
  const mn = new Array(n).fill(Infinity), mx = new Array(n).fill(-Infinity);
  for (let i = 0; i < arr.length; i += n) for (let a = 0; a < n; a++) {
    mn[a] = Math.min(mn[a], arr[i + a]); mx[a] = Math.max(mx[a], arr[i + a]);
  }
  return { mn, mx };
};
const pmm = minMax(pos, 3);
const json = Buffer.from(JSON.stringify({
  asset: { version: '2.0', generator: 'bronco-roam make-test-prop' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'TestProp' }],
  meshes: [{ name: 'TestProp', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 } }] }],
  accessors: [
    { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: pmm.mn, max: pmm.mx },
    { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count, type: 'VEC3' }
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: pB.length },
    { buffer: 0, byteOffset: pB.length, byteLength: nB.length },
    { buffer: 0, byteOffset: pB.length + nB.length, byteLength: cB.length }
  ],
  buffers: [{ byteLength: bin.length }]
}), 'utf8');
const jp = pad4(json.length % 4 ? Buffer.concat([json, Buffer.alloc(4 - json.length % 4, 0x20)]) : json);
const ch = (b, type) => {
  const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4);
  return Buffer.concat([h, b]);
};
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
writeFileSync(out + '.glb', Buffer.concat([head, ch(jp, 0x4e4f534a), ch(bin, 0x004e4942)]));
console.log(`wrote ${out}.glb — ${count / 3} triangles, base at y=${BASEY}, centred at (${OFFX}, ${OFFZ})`);
