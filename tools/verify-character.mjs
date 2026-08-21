#!/usr/bin/env node
/* Render the imported character straight out of index.html, without the game.

     node tools/verify-character.mjs                 # rest pose + both clips
     node tools/verify-character.mjs --clip=Wave --t=1.2

   Decodes the SKC1 blob, poses the skeleton, skins on the CPU, and rasterises
   flat-shaded triangles into a 2D canvas. The decoder here is written from the
   format spec rather than shared with the engine's, so if the two agree the
   format is unambiguous — and this catches a wrecked silhouette or a bad bake
   before any of it reaches a shader.

   Needs playwright for the canvas. */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const HTML = opt('html', 'index.html');
const OUT = opt('out', 'character.png');

/* ------------------------------------------------------------- decode --- */
const html = readFileSync(HTML, 'utf8');
const m = html.match(/const IMPORTED_CHARACTER = (\{[\s\S]*?\});\n/);
if (!m) throw new Error('no character imported into ' + HTML);
const meta = JSON.parse(m[1]);
const buf = Buffer.from(meta.data, 'base64');

if (buf.toString('ascii', 0, 4) !== 'SKC1') throw new Error('bad character blob');
const vCount = buf.readUInt32LE(4), pScale = buf.readFloatLE(8);
const jCount = buf.readUInt16LE(12), cCount = buf.readUInt16LE(14);
let o = 16;

const verts = [];
for (let i = 0; i < vCount; i++) {
  verts.push({
    p: [buf.readInt16LE(o) * pScale, buf.readInt16LE(o + 2) * pScale, buf.readInt16LE(o + 4) * pScale],
    n: [buf.readInt8(o + 6) / 127, buf.readInt8(o + 7) / 127, buf.readInt8(o + 8) / 127],
    c: [buf[o + 9] / 255, buf[o + 10] / 255, buf[o + 11] / 255],
    j: [buf[o + 12], buf[o + 13], buf[o + 14], buf[o + 15]],
    w: [buf[o + 16] / 255, buf[o + 17] / 255, buf[o + 18] / 255, buf[o + 19] / 255]
  });
  o += 20;
}
const bones = [];
for (let i = 0; i < jCount; i++) {
  const parent = buf.readInt8(o); o += 1;
  const f = (n) => { const a = []; for (let k = 0; k < n; k++) { a.push(buf.readFloatLE(o)); o += 4; } return a; };
  bones.push({ parent, t: f(3), r: f(4), s: f(3), ib: f(16) });
}
const clips = [];
for (let i = 0; i < cCount; i++) {
  const nl = buf.readUInt8(o); o += 1;
  const name = buf.toString('ascii', o, o + nl); o += nl;
  const duration = buf.readFloatLE(o); o += 4;
  const nt = buf.readUInt16LE(o); o += 2;
  const tracks = [];
  for (let k = 0; k < nt; k++) {
    const joint = buf.readUInt8(o), path = buf.readUInt8(o + 1), keys = buf.readUInt16LE(o + 2); o += 4;
    const times = []; for (let q = 0; q < keys; q++) { times.push(buf.readUInt16LE(o) / 1000); o += 2; }
    const n = path === 1 ? 4 : 3, values = [];
    for (let q = 0; q < keys * n; q++) {
      if (path === 1) { values.push(buf.readInt16LE(o) / 32767); o += 2; }
      else { values.push(buf.readFloatLE(o)); o += 4; }
    }
    tracks.push({ joint, path, times, values });
  }
  clips.push({ name, duration, tracks });
}
console.log(`${meta.tris} triangles, ${jCount} joints, ${clips.map(c => c.name + ' ' + c.duration.toFixed(2) + 's').join(' / ')}`);
console.log(`decoded ${o} of ${buf.length} bytes` + (o === buf.length ? ' — exact' : '  *** TRAILING BYTES ***'));

/* --------------------------------------------------------------- pose --- */
const m4mul = (a, b) => { const t = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) t[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return t; };
const trs = (t, r, s) => { const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
          (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
          (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
          t[0], t[1], t[2], 1]; };
const nlerp = (a, b, f, o) => {
  let d = 0; for (let k = 0; k < 4; k++) d += a[k] * b[k];
  const s = d < 0 ? -1 : 1;
  let l = 0; for (let k = 0; k < 4; k++) { o[k] = a[k] + (b[k] * s - a[k]) * f; l += o[k] * o[k]; }
  l = Math.sqrt(l) || 1; for (let k = 0; k < 4; k++) o[k] /= l;
  return o;
};

function pose(clip, time) {
  const local = bones.map(b => ({ t: [...b.t], r: [...b.r], s: [...b.s] }));
  if (clip) {
    const tm = clip.duration > 0 ? time % clip.duration : 0;
    for (const tr of clip.tracks) {
      const n = tr.path === 1 ? 4 : 3;
      let k = 0; while (k < tr.times.length - 1 && tr.times[k + 1] <= tm) k++;
      const k2 = Math.min(k + 1, tr.times.length - 1);
      const span = tr.times[k2] - tr.times[k];
      const f = span > 1e-6 ? (tm - tr.times[k]) / span : 0;
      const A = tr.values.slice(k * n, k * n + n), B = tr.values.slice(k2 * n, k2 * n + n);
      const dst = local[tr.joint];
      if (tr.path === 1) nlerp(A, B, f, dst.r);
      else { const key = tr.path === 0 ? 't' : 's';
             for (let c = 0; c < 3; c++) dst[key][c] = A[c] + (B[c] - A[c]) * f; }
    }
  }
  const world = [];
  for (let j = 0; j < bones.length; j++) {
    const l = trs(local[j].t, local[j].r, local[j].s);
    world[j] = bones[j].parent < 0 ? l : m4mul(world[bones[j].parent], l);
  }
  return world.map((w, j) => m4mul(w, bones[j].ib));
}

function skin(mats) {
  const out = [];
  for (const v of verts) {
    const p = [0, 0, 0], n = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = v.w[k]; if (w <= 0) continue;
      const M = mats[v.j[k]];
      for (let r = 0; r < 3; r++) {
        p[r] += w * (M[r] * v.p[0] + M[4 + r] * v.p[1] + M[8 + r] * v.p[2] + M[12 + r]);
        n[r] += w * (M[r] * v.n[0] + M[4 + r] * v.n[1] + M[8 + r] * v.n[2]);
      }
    }
    out.push({ p, n, c: v.c });
  }
  return out;
}

/* ------------------------------------------------------------- render --- */
const frames = [];
const wanted = opt('clip', null);
if (wanted) frames.push({ label: `${wanted} t=${opt('t', '0')}`, clip: clips.find(c => c.name === wanted), t: +opt('t', 0) });
else {
  frames.push({ label: 'rest', clip: null, t: 0 });
  for (const c of clips) for (const f of [0.25, 0.5, 0.75])
    frames.push({ label: `${c.name} ${Math.round(f * 100)}%`, clip: c, t: c.duration * f });
}
/* --view-yaw spins the camera about the figure: a character authored facing
   +X reads as a profile from the default angle and tells you nothing about
   whether the face survived decimation. */
const VIEW = +opt('view-yaw', 0) * Math.PI / 180;
const spin = (V) => {
  if (!VIEW) return V;
  const c = Math.cos(VIEW), s2 = Math.sin(VIEW);
  return V.map(v => ({ c: v.c,
    p: [v.p[0] * c + v.p[2] * s2, v.p[1], -v.p[0] * s2 + v.p[2] * c],
    n: [v.n[0] * c + v.n[2] * s2, v.n[1], -v.n[0] * s2 + v.n[2] * c] }));
};
const shots = frames.map(f => ({ label: f.label, tris: spin(skin(pose(f.clip, f.t))) }));

const { chromium } = await import('playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const W = 300, H = 420;
const page = await (await b.newContext({ viewport: { width: W * shots.length, height: H } })).newPage();
await page.setContent('<body style="margin:0;background:#cfe0ee"></body>');
await page.evaluate(({ shots, W, H }) => {
  const cv = document.createElement('canvas');
  cv.width = W * shots.length; cv.height = H;
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  g.fillStyle = '#cfe0ee'; g.fillRect(0, 0, cv.width, cv.height);
  const sun = [-0.42, 0.55, 0.72];
  shots.forEach((s, si) => {
    const V = s.tris;
    /* fit the figure to the panel */
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const v of V) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v.p[a]); hi[a] = Math.max(hi[a], v.p[a]); }
    const scale = (H * 0.82) / (hi[1] - lo[1]);
    const cx = si * W + W / 2 - ((lo[0] + hi[0]) / 2) * scale;
    const cy = H * 0.93 + lo[1] * scale;
    const tri = [];
    for (let i = 0; i < V.length; i += 3) {
      const q = [V[i], V[i + 1], V[i + 2]];
      tri.push({ q, z: (q[0].p[2] + q[1].p[2] + q[2].p[2]) / 3 });
    }
    tri.sort((a, b2) => a.z - b2.z);          /* painter's algorithm, +z toward viewer */
    for (const t of tri) {
      const n = t.q[0].n, l = Math.hypot(n[0], n[1], n[2]) || 1;
      const d = Math.max(0, (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / l);
      const sh = 0.34 + 0.78 * d;
      const c = t.q[0].c;
      g.fillStyle = `rgb(${Math.min(255, c[0] * 255 * sh) | 0},${Math.min(255, c[1] * 255 * sh) | 0},${Math.min(255, c[2] * 255 * sh) | 0})`;
      g.beginPath();
      g.moveTo(cx + t.q[0].p[0] * scale, cy - t.q[0].p[1] * scale);
      g.lineTo(cx + t.q[1].p[0] * scale, cy - t.q[1].p[1] * scale);
      g.lineTo(cx + t.q[2].p[0] * scale, cy - t.q[2].p[1] * scale);
      g.closePath(); g.fill();
    }
    g.fillStyle = '#20303c'; g.font = '13px system-ui'; g.textAlign = 'center';
    g.fillText(s.label, si * W + W / 2, 18);
  });
}, { shots, W, H });
await page.screenshot({ path: OUT });
await b.close();
console.log('wrote ' + OUT + ' — now LOOK at it');
