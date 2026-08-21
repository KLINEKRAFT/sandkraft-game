/* Shared mesh reduction and SKM1 packing, used by both importers.
   SKM1 is int16 positions x a scale, int8 normals and uint8 colour, which
   decodes to exactly the interleaved layout MB.upload() already produces — so
   the renderer needs no special case for an imported mesh.

   pack(tris, {gzip:true}) deflates the blob before base64. SKM1 is three
   whole vertices per triangle with the face normal written out three times
   and, on a mesh with a handful of materials, the same colour on nearly every
   one — which is to say most of it is repetition that a dictionary coder eats.
   The browser inflates it with its own DecompressionStream, so this costs no
   code in the engine beyond noticing the gzip magic. Only worth it on a blob
   big enough that base64's 33% expansion is not the dominant term.
   Node's zlib is the only import here; nothing else has dependencies. */
import { gzipSync } from 'node:zlib';

/* -------------------------------------------------------------- reduce -- */
export function decimate(tris, budget) {
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
export function pack(tris, opts = {}) {
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
  return (opts.gzip ? gzipSync(buf, { level: 9 }) : buf).toString('base64');
}
