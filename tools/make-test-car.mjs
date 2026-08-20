#!/usr/bin/env node
/* Test fixture for the importer: a blocky car with named wheel objects,
   written as both OBJ+MTL and GLB, in Blender's Z-up / -Y-forward layout.
     node tools/make-test-car.mjs out/prefix
   Exists so the import path can be verified without an authored asset. */
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'test-car';
const objects = [];
const box = (name, c, s, col) => {
  const [hx, hy, hz] = s.map(v => v / 2);
  const P = [];
  for (let i = 0; i < 8; i++)
    P.push([c[0] + (i & 1 ? hx : -hx), c[1] + (i & 2 ? hy : -hy), c[2] + (i & 4 ? hz : -hz)]);
  const F = [[4,5,7,6],[1,0,2,3],[5,1,3,7],[0,4,6,2],[6,7,3,2],[0,1,5,4]];
  objects.push({ name, verts: P, faces: F, col });
};
/* wheel: cylinder about X, in Z-up space */
const wheel = (name, c, r, w, col) => {
  const P = [], F = [], seg = 14;
  for (let i = 0; i < seg; i++) {
    const t = 2 * Math.PI * i / seg;
    P.push([c[0] - w / 2, c[1] + Math.cos(t) * r, c[2] + Math.sin(t) * r]);
    P.push([c[0] + w / 2, c[1] + Math.cos(t) * r, c[2] + Math.sin(t) * r]);
  }
  P.push([c[0] - w / 2, c[1], c[2]]); P.push([c[0] + w / 2, c[1], c[2]]);
  const L = P.length;
  for (let i = 0; i < seg; i++) {
    const a = i * 2, bb = ((i + 1) % seg) * 2;
    F.push([a + 1, a, bb, bb + 1]);
    F.push([L - 2, bb, a]);
    F.push([L - 1, a + 1, bb + 1]);
  }
  objects.push({ name, verts: P, faces: F, col });
};

/* Z-up, -Y forward: body long on Y, cabin biased to +Y (the rear) */
box('body',   [0,  0.10, 1.15], [1.90, 4.40, 1.10], [0.78, 0.78, 0.76]);
box('cabin',  [0,  0.75, 1.95], [1.74, 2.20, 0.90], [0.10, 0.11, 0.13]);
box('bumper', [0, -2.05, 0.85], [1.94, 0.30, 0.45], [0.13, 0.13, 0.14]);
wheel('wheel_fl', [-0.80, -1.45, 0.42], 0.42, 0.32, [0.06, 0.06, 0.07]);
wheel('wheel_fr', [ 0.80, -1.45, 0.42], 0.42, 0.32, [0.06, 0.06, 0.07]);
wheel('wheel_rl', [-0.80,  1.45, 0.42], 0.42, 0.32, [0.06, 0.06, 0.07]);
wheel('wheel_rr', [ 0.80,  1.45, 0.42], 0.42, 0.32, [0.06, 0.06, 0.07]);

/* ------------------------------------------------------------- OBJ+MTL -- */
let obj = `mtllib ${out.split('/').pop()}.mtl\n`, mtl = '', base = 1;
for (const o of objects) {
  mtl += `newmtl m_${o.name}\nKd ${o.col.join(' ')}\n\n`;
  obj += `o ${o.name}\nusemtl m_${o.name}\n`;
  for (const v of o.verts) obj += `v ${v.map(x => x.toFixed(5)).join(' ')}\n`;
  for (const f of o.faces) obj += 'f ' + f.map(i => base + i).join(' ') + '\n';
  base += o.verts.length;
}
writeFileSync(out + '.obj', obj);
writeFileSync(out + '.mtl', mtl);

/* ----------------------------------------------------------------- GLB -- */
const chunks = [], accessors = [], bufferViews = [], meshes = [], nodes = [], materials = [];
let off = 0;
const pushView = (buf, target) => {
  while (off % 4) { chunks.push(Buffer.alloc(1)); off++; }
  bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.length, target });
  chunks.push(buf); off += buf.length;
  return bufferViews.length - 1;
};
for (const o of objects) {
  const tri = [];
  for (const f of o.faces) for (let i = 1; i + 1 < f.length; i++) tri.push(f[0], f[i], f[i + 1]);
  const pos = Buffer.alloc(o.verts.length * 12);
  o.verts.forEach((v, i) => v.forEach((x, a) => pos.writeFloatLE(x, i * 12 + a * 4)));
  const idx = Buffer.alloc(tri.length * 2);
  tri.forEach((v, i) => idx.writeUInt16LE(v, i * 2));
  const lo = [0,1,2].map(a => Math.min(...o.verts.map(v => v[a])));
  const hi = [0,1,2].map(a => Math.max(...o.verts.map(v => v[a])));
  accessors.push({ bufferView: pushView(pos, 34962), componentType: 5126, count: o.verts.length, type: 'VEC3', min: lo, max: hi });
  const pa = accessors.length - 1;
  accessors.push({ bufferView: pushView(idx, 34963), componentType: 5123, count: tri.length, type: 'SCALAR' });
  materials.push({ name: 'm_' + o.name, pbrMetallicRoughness: { baseColorFactor: [...o.col, 1] } });
  meshes.push({ name: o.name, primitives: [{ attributes: { POSITION: pa }, indices: pa + 1, material: materials.length - 1, mode: 4 }] });
  nodes.push({ name: o.name, mesh: meshes.length - 1 });
}
const bin = Buffer.concat(chunks);
const json = Buffer.from(JSON.stringify({
  asset: { version: '2.0', generator: 'sandkraft test fixture' },
  scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }]
}), 'utf8');
const pad = (b, v) => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4, v)]) : b;
const jp = pad(json, 0x20), bp = pad(bin, 0);
const head = Buffer.alloc(12);
head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + jp.length + 8 + bp.length, 8);
const ch = (b, t) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(t, 4); return Buffer.concat([h, b]); };
writeFileSync(out + '.glb', Buffer.concat([head, ch(jp, 0x4e4f534a), ch(bp, 0x004e4942)]));
console.log(`wrote ${out}.obj / .mtl / .glb — ${objects.length} objects`);
