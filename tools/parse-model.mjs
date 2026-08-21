/* Mesh readers for the Bronco Roam importer: OBJ (+MTL) and glTF/GLB.
   Both return the same shape:
     { parts: [ { name, tris: [{p:[3][3], n:[3][3]|null, c:[r,g,b]}] } ] }
   No dependencies — this runs on a bare node. */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseFBX } from './parse-fbx.mjs';

/* ------------------------------------------------------------------ OBJ -- */
function parseMTL(file) {
  const mats = new Map();
  if (!existsSync(file)) return mats;
  let cur = null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === 'newmtl') { cur = t[1]; mats.set(cur, { kd: [0.7, 0.7, 0.7] }); }
    else if (t[0] === 'Kd' && cur) mats.get(cur).kd = [+t[1], +t[2], +t[3]];
    else if (t[0] === 'map_Kd' && cur) mats.get(cur).map = t.slice(1).join(' ');
  }
  return mats;
}

export function parseOBJ(file) {
  const src = readFileSync(file, 'utf8');
  const dir = dirname(resolve(file));
  const V = [], N = [], C = [];
  let mats = new Map(), mat = null, group = 'default';
  const parts = new Map();
  const partFor = (name) => {
    if (!parts.has(name)) parts.set(name, { name, tris: [] });
    return parts.get(name);
  };
  const idx = (s, len) => { const i = parseInt(s, 10); return i < 0 ? len + i : i - 1; };

  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const t = line.split(/\s+/);
    switch (t[0]) {
      case 'v':
        V.push([+t[1], +t[2], +t[3]]);
        /* some exporters append per-vertex colour after xyz */
        if (t.length >= 7) C.push([+t[4], +t[5], +t[6]]); else C.push(null);
        break;
      case 'vn': N.push([+t[1], +t[2], +t[3]]); break;
      case 'mtllib': mats = new Map([...mats, ...parseMTL(resolve(dir, t.slice(1).join(' ')))]); break;
      case 'usemtl': mat = t[1]; break;
      case 'g': case 'o': group = t.slice(1).join(' ') || 'default'; break;
      case 'f': {
        const verts = t.slice(1).map(tok => {
          const f = tok.split('/');
          return { v: idx(f[0], V.length), n: f[2] ? idx(f[2], N.length) : -1 };
        });
        const kd = (mat && mats.get(mat)) ? mats.get(mat).kd : null;
        const part = partFor(group + (mat ? '/' + mat : ''));
        for (let i = 1; i + 1 < verts.length; i++) {      /* fan triangulate */
          const tri = [verts[0], verts[i], verts[i + 1]];
          const vc = tri.map(a => C[a.v]).filter(Boolean);
          part.tris.push({
            p: tri.map(a => V[a.v]),
            n: tri.every(a => a.n >= 0) ? tri.map(a => N[a.n]) : null,
            c: vc.length === 3 ? vc[0] : (kd || [0.68, 0.68, 0.68])
          });
        }
        break;
      }
    }
  }
  return { parts: [...parts.values()].filter(p => p.tris.length) };
}

/* ------------------------------------------------------------- glTF/GLB -- */
const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
               5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function m4mul(a, b) {                       /* column-major, as in glTF */
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
export function trsToM4(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1
  ];
}
const xformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
];
const xformDir = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2]
];

/* Container + accessor reading, split out so the skinned-character importer can
   share them: it needs indexed vertices in skin space, which is the opposite of
   what parseGLTF below produces. */
export function readGLTFContainer(file) {
  const buf = readFileSync(file);
  let json, bin = null;
  if (buf.readUInt32LE(0) === 0x46546c67) {               /* 'glTF' — binary */
    let off = 12;
    while (off < buf.length) {
      const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
      else if (type === 0x004e4942) bin = data;
      off += 8 + len + ((4 - (len % 4)) % 4);
    }
  } else {
    json = JSON.parse(buf.toString('utf8'));
  }
  if (!json) throw new Error('no JSON chunk in ' + file);
  const ext = json.extensionsRequired || [];
  if (ext.some(e => /draco/i.test(e)))
    throw new Error('this glTF uses Draco compression — re-export with Draco OFF');
  if (ext.some(e => /meshopt/i.test(e)))
    throw new Error('this glTF uses meshopt compression — re-export without it');

  const dir = dirname(resolve(file));
  const buffers = (json.buffers || []).map((b) => {
    if (!b.uri) return bin;
    if (b.uri.startsWith('data:')) return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
    return readFileSync(resolve(dir, decodeURIComponent(b.uri)));
  });
  return { json, buffers, bin, dir };
}

/* raw bytes of a bufferView — for embedded texture images */
export function viewBytes(json, buffers, vi) {
  const bv = json.bufferViews[vi];
  const src = buffers[bv.buffer];
  const off = (bv.byteOffset || 0);
  return src.subarray(off, off + bv.byteLength);
}

export function makeAccessorReader(json, buffers) {
  return (ai) => {
    const acc = json.accessors[ai];
    const n = NCOMP[acc.type];
    const [Arr, sz] = COMP[acc.componentType];
    const out = new Float32Array(acc.count * n);
    if (acc.bufferView === undefined) return out;          /* all zeros */
    const bv = json.bufferViews[acc.bufferView];
    const src = buffers[bv.buffer];
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || n * sz;
    const norm = acc.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[acc.componentType] : 0;
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      for (let c = 0; c < n; c++) {
        const v = new Arr(src.buffer, src.byteOffset + o + c * sz, 1)[0];
        out[i * n + c] = norm ? Math.max(v / norm, acc.componentType === 5120 || acc.componentType === 5122 ? -1 : 0) : v;
      }
    }
    return out;
  };
}

export function parseGLTF(file) {
  const { json, buffers } = readGLTFContainer(file);
  const readAccessor = makeAccessorReader(json, buffers);

  /* flatten the node hierarchy to world transforms */
  const jobs = [];
  const walk = (ni, parent) => {
    const node = json.nodes[ni];
    const local = node.matrix ? node.matrix
      : trsToM4(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
    const world = m4mul(parent, local);
    if (node.mesh !== undefined) jobs.push({ mesh: node.mesh, world, name: node.name || ('node' + ni) });
    for (const c of node.children || []) walk(c, world);
  };
  const ident = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const scene = json.scenes ? json.scenes[json.scene || 0] : null;
  for (const r of (scene ? scene.nodes : json.nodes.map((_, i) => i))) walk(r, ident);

  const parts = [];
  for (const job of jobs) {
    const mesh = json.meshes[job.mesh];
    for (let pi = 0; pi < mesh.primitives.length; pi++) {
      const prim = mesh.primitives[pi];
      if (prim.mode !== undefined && prim.mode !== 4) continue;   /* triangles only */
      const P = readAccessor(prim.attributes.POSITION);
      const NRM = prim.attributes.NORMAL !== undefined ? readAccessor(prim.attributes.NORMAL) : null;
      const COL = prim.attributes.COLOR_0 !== undefined ? readAccessor(prim.attributes.COLOR_0) : null;
      const colN = COL ? NCOMP[json.accessors[prim.attributes.COLOR_0].type] : 0;
      let idx;
      if (prim.indices !== undefined) idx = readAccessor(prim.indices);
      else { idx = new Float32Array(P.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i; }

      let base = [0.68, 0.68, 0.68];
      const matName = prim.material !== undefined ? (json.materials[prim.material].name || '') : '';
      if (prim.material !== undefined) {
        const m = json.materials[prim.material];
        const f = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor;
        if (f) base = [f[0], f[1], f[2]];
        else if (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture) base = [0.62, 0.62, 0.62];
      }
      const part = { name: [job.name, mesh.name, matName].filter(Boolean).join('/') || 'part', tris: [] };
      for (let i = 0; i + 2 < idx.length; i += 3) {
        const a = idx[i], b = idx[i + 1], c = idx[i + 2];
        const tri = [a, b, c];
        part.tris.push({
          p: tri.map(v => xformPoint(job.world, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]])),
          n: NRM ? tri.map(v => xformDir(job.world, [NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]])) : null,
          c: COL ? [COL[a * colN], COL[a * colN + 1], COL[a * colN + 2]] : base
        });
      }
      if (part.tris.length) parts.push(part);
    }
  }
  return { parts };
}

export function parseModel(file, opts = {}) {
  if (/\.obj$/i.test(file)) return parseOBJ(file);
  if (/\.(gltf|glb)$/i.test(file)) return parseGLTF(file);
  if (/\.fbx$/i.test(file)) return parseFBX(file, opts);
  if (/\.blend$/i.test(file))
    throw new Error('.blend is Blender’s internal format and cannot be read here — export GLB or OBJ instead');
  throw new Error('unsupported model format: ' + file);
}
