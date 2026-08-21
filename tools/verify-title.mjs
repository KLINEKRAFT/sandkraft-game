#!/usr/bin/env node
/* Render the imported wordmark straight out of index.html, without the game.

     node tools/verify-title.mjs
     node tools/verify-title.mjs --tilt=12 --px=900

   Decodes the SKM1 blob and rasterises it flat-shaded into a 2D canvas at the
   size the cover actually shows it, because the only question decimation
   raises here is whether you can still read the words. Needs playwright. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const HTML = opt('html', 'index.html');
const OUT = opt('out', 'title.png');
const PX = +opt('px', 760);
const TILT = +opt('tilt', 10) * Math.PI / 180;

const html = readFileSync(HTML, 'utf8');
const m = html.match(/const IMPORTED_TITLE = (\{[\s\S]*?\});\n/);
if (!m) throw new Error('no title imported into ' + HTML);
const meta = JSON.parse(m[1]);
let buf = Buffer.from(meta.data, 'base64');
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);   /* same magic the engine looks for */
if (buf.toString('ascii', 0, 4) !== 'SKM1') throw new Error('bad title blob');
const n = buf.readUInt32LE(4), s = buf.readFloatLE(8);
console.log(`${n} triangles in ${(meta.words || []).length || 1} word group(s), ` +
            `${meta.width} x ${meta.height} x ${meta.depth} m, ` +
            `${(meta.data.length / 1024).toFixed(0)} KB base64`);

const V = [];
for (let i = 0, o = 12; i < n * 3; i++, o += 12) {
  V.push({ p: [buf.readInt16LE(o) * s, buf.readInt16LE(o + 2) * s, buf.readInt16LE(o + 4) * s],
           nr: [buf.readInt8(o + 6) / 127, buf.readInt8(o + 7) / 127, buf.readInt8(o + 8) / 127],
           c: [buf[o + 9] / 255, buf[o + 10] / 255, buf[o + 11] / 255] });
}
/* tilt about X, the way the cover leans it back */
const ct = Math.cos(TILT), st = Math.sin(TILT);
for (const v of V) {
  const rot = a => [a[0], a[1] * ct - a[2] * st, a[1] * st + a[2] * ct];
  v.p = rot(v.p); v.nr = rot(v.nr);
}

const H = Math.round(PX * (meta.height + meta.depth) / meta.width * 1.5);
const { chromium } = await import('playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await b.newContext({ viewport: { width: PX, height: H } })).newPage();
await page.setContent('<body style="margin:0"></body>');
await page.evaluate(({ V, PX, H, W }) => {
  const cv = document.createElement('canvas');
  cv.width = PX; cv.height = H; document.body.appendChild(cv);
  const g = cv.getContext('2d');
  g.fillStyle = '#4a5b6a'; g.fillRect(0, 0, PX, H);
  const sun = [-0.35, 0.62, 0.70];
  const scale = PX * 0.94 / W, cx = PX / 2, cy = H / 2;
  const tri = [];
  for (let i = 0; i < V.length; i += 3)
    tri.push({ q: [V[i], V[i + 1], V[i + 2]], z: (V[i].p[2] + V[i + 1].p[2] + V[i + 2].p[2]) / 3 });
  tri.sort((a, c) => a.z - c.z);
  for (const t of tri) {
    const nr = t.q[0].nr, l = Math.hypot(nr[0], nr[1], nr[2]) || 1;
    const d = Math.max(0, (nr[0] * sun[0] + nr[1] * sun[1] + nr[2] * sun[2]) / l);
    const sh = 0.30 + 0.85 * d, c = t.q[0].c;
    g.fillStyle = `rgb(${Math.min(255, c[0] * 255 * sh) | 0},${Math.min(255, c[1] * 255 * sh) | 0},${Math.min(255, c[2] * 255 * sh) | 0})`;
    g.beginPath();
    g.moveTo(cx + t.q[0].p[0] * scale, cy - t.q[0].p[1] * scale);
    g.lineTo(cx + t.q[1].p[0] * scale, cy - t.q[1].p[1] * scale);
    g.lineTo(cx + t.q[2].p[0] * scale, cy - t.q[2].p[1] * scale);
    g.closePath(); g.fill();
  }
}, { V, PX, H, W: meta.width });
await page.screenshot({ path: OUT });
await b.close();
console.log('wrote ' + OUT + ' — now LOOK at it');
