#!/usr/bin/env node
/* Look at the soundtrack, since you cannot listen to it from here.

     node tools/verify-audio.mjs                    # 24 s sweep, writes audio.png
     node tools/verify-audio.mjs --station=2 --secs=16

   Everything the game makes noise with is synthesised, which means every way
   it can be wrong is silent-to-the-eye: a scheduler that never fires, a bus
   left at zero, a riff whose notes all land on the same pitch, a mix that
   clips into the limiter and stays there. None of those throw, and none of
   them show up in a screenshot.

   So this drives the car through the whole intensity range with an analyser on
   the master bus, plots the spectrum against time, and prints the numbers that
   decide whether it is music: peak and RMS per bus, energy split across the
   drum/guitar/air bands, and which section the arranger picked at each speed.
   A spectrogram of a riff has visible structure — vertical stripes on the
   beat, a moving fundamental, harmonics stacked above it. A dead one is a
   flat wash, and you can see that in a second.

   Needs playwright. Nothing else. */
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const OUT = opt('out', 'audio.png');
const SECS = +opt('secs', 24);
const STATION = +opt('station', 1);
const HTML = opt('html', 'index.html');

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--autoplay-policy=no-user-gesture-required']
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 520 } })).newPage();
const errs = [];
page.on('pageerror', e => errs.push('' + e.message));
await page.goto('file://' + resolve(HTML));
for (let i = 0; i < 50; i++) {
  if (await page.evaluate(() => document.getElementById('go').classList.contains('ready'))) break;
  await page.waitForTimeout(700);
}
await page.click('#go');
await page.waitForTimeout(500);

const cap = await page.evaluate(async ({ SECS, STATION }) => {
  audio.station = STATION;
  const ctx = audio.ctx, a = audio.nodes;
  const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.35;
  a.master.connect(an);
  const anM = ctx.createAnalyser(); anM.fftSize = 1024; anM.smoothingTimeConstant = 0.35;
  a.musicBus.connect(anM);

  const freq = new Float32Array(an.frequencyBinCount);
  const timeBuf = new Float32Array(an.fftSize);
  const fm = new Float32Array(anM.frequencyBinCount);

  const rows = [], marks = [];
  let peak = 0, sumSq = 0, nSamp = 0, clipFrames = 0;
  const t0 = performance.now();
  /* hold the truck at a commanded speed so the arranger is driven through
     every section rather than whatever the physics happens to do */
  const plan = [2, 9, 17, 24, 31, 38, 41, 41];
  while (performance.now() - t0 < SECS * 1000) {
    const el = (performance.now() - t0) / 1000;
    const want = plan[Math.min(plan.length - 1, Math.floor(el / (SECS / plan.length)))];
    car.v.x = 0; car.v.y = 0; car.v.z = want; car.fwd.x = 0; car.fwd.y = 0; car.fwd.z = 1;
    car.throttle = 1; car.contacts = 4;

    an.getFloatFrequencyData(freq);
    an.getFloatTimeDomainData(timeBuf);
    anM.getFloatFrequencyData(fm);
    /* 512 bins is more than a plot needs; fold to 128 by taking the max, which
       keeps a narrow harmonic visible instead of averaging it away */
    const col = new Array(128);
    for (let i = 0; i < 128; i++) {
      let m = -140;
      for (let k = 0; k < 4; k++) m = Math.max(m, freq[i * 4 + k]);
      col[i] = m;
    }
    rows.push(col);
    for (let i = 0; i < timeBuf.length; i++) {
      const v = Math.abs(timeBuf[i]);
      if (v > peak) peak = v;
      sumSq += timeBuf[i] * timeBuf[i]; nSamp++;
      if (v > 0.995) clipFrames++;
    }
    marks.push({ t: +el.toFixed(2), sec: SECTIONS[seq.sec].id, mph: Math.round(want * 2.23694),
                 gear: eng.gear, bar: seq.bar });
    await new Promise(r => setTimeout(r, 45));
  }

  /* band energy, from the last spectrum snapshot averaged over the run */
  const nyq = ctx.sampleRate / 2, binHz = nyq / freq.length;
  const bandOf = hz => Math.min(freq.length - 1, Math.round(hz / binHz));
  const bands = { sub: [20, 90], kick: [90, 200], body: [200, 700], guitar: [700, 3000], air: [3000, 12000] };
  const energy = {};
  for (const k of Object.keys(bands)) {
    const [lo, hi] = bands[k].map(bandOf);
    let s = 0, n = 0;
    for (const col of rows) for (let i = Math.floor(lo / 4); i <= Math.floor(hi / 4) && i < 128; i++) {
      s += Math.pow(10, col[i] / 20); n++;
    }
    energy[k] = n ? +(20 * Math.log10(s / n)).toFixed(1) : -140;
  }
  return { rows, marks, sampleRate: ctx.sampleRate,
           peak: +peak.toFixed(4), rms: +Math.sqrt(sumSq / Math.max(1, nSamp)).toFixed(4),
           clipFrames, energy, station: audio.station };
}, { SECS, STATION });

/* ------------------------------------------------------------- report --- */
const secs = [...new Set(cap.marks.map(m => m.sec))];
const timeline = [];
let cur = null;
for (const m of cap.marks) {
  if (!cur || cur.sec !== m.sec) { cur = { sec: m.sec, from: m.t, mph: m.mph, gear: m.gear }; timeline.push(cur); }
  cur.to = m.t; cur.mph = m.mph; cur.gear = m.gear;
}
console.log(`station ${['OFF','ROAM','THRASH','AM'][cap.station]}  ${cap.sampleRate} Hz  ` +
            `${cap.rows.length} spectra over ${SECS}s`);
console.table(timeline);
console.table([{ peak: cap.peak, rms: cap.rms, clippedFrames: cap.clipFrames, ...cap.energy }]);

const fail = [];
if (cap.rms < 0.005) fail.push(`master RMS ${cap.rms} — this is silence, the mix never reached the bus`);
if (cap.peak > 0.999 && cap.clipFrames > cap.rows.length * 8)
  fail.push(`${cap.clipFrames} clipped samples — the limiter is being driven into the rails, pull a bus down`);
if (secs.length < 3) fail.push(`only reached section(s) ${secs.join(', ')} — the arranger is not tracking speed`);
if (cap.energy.guitar < -100) fail.push('nothing in the guitar band: the riff is not sounding');
if (cap.energy.kick < -100) fail.push('nothing in the kick band: the drums are not sounding');

/* --------------------------------------------------------- spectrogram -- */
const W = Math.min(1400, cap.rows.length * 3), H = 420;
const page2 = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
await page2.setContent('<body style="margin:0;background:#0b1219"></body>');
await page2.evaluate(({ rows, marks, W, H, sampleRate, label }) => {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H; document.body.appendChild(cv);
  const g = cv.getContext('2d');
  g.fillStyle = '#0b1219'; g.fillRect(0, 0, W, H);
  const plotH = H - 34, cw = W / rows.length;
  for (let x = 0; x < rows.length; x++) {
    const col = rows[x];
    for (let i = 0; i < col.length; i++) {
      /* dB to a heat ramp: -100 is the floor, -20 is loud */
      const v = Math.max(0, Math.min(1, (col[i] + 100) / 80));
      if (v <= 0.02) continue;
      const r = Math.min(255, v * 380), gg = Math.min(255, Math.pow(v, 1.7) * 300), b = Math.min(255, Math.pow(v, 3) * 260 + v * 60);
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      /* log frequency, so the low end where a riff lives is not one pixel */
      const f0 = i / col.length, f1 = (i + 1) / col.length;
      const ly = q => plotH * (1 - Math.log10(1 + q * 60) / Math.log10(61));
      g.fillRect(x * cw, ly(f1), Math.ceil(cw), Math.max(1, ly(f0) - ly(f1)));
    }
  }
  /* frequency guides */
  g.font = '10px ui-monospace,Menlo,monospace';
  for (const hz of [60, 120, 250, 500, 1000, 2000, 4000, 8000]) {
    const q = hz / (sampleRate / 2);
    const y = plotH * (1 - Math.log10(1 + q * 60) / Math.log10(61));
    g.fillStyle = 'rgba(160,200,230,0.22)'; g.fillRect(0, y, W, 1);
    g.fillStyle = 'rgba(190,215,235,0.75)'; g.fillText(hz >= 1000 ? (hz / 1000) + 'k' : hz + '', 4, y - 3);
  }
  /* section bands along the bottom */
  let cur = null;
  g.fillStyle = '#101b26'; g.fillRect(0, plotH, W, 34);
  for (let x = 0; x < marks.length; x++) {
    if (!cur || cur.sec !== marks[x].sec) {
      if (cur) { g.fillStyle = 'rgba(160,200,230,0.35)'; g.fillRect(x * cw, plotH, 1, 34); }
      cur = marks[x];
      g.fillStyle = '#cfe2f2';
      g.fillText(marks[x].sec + '  ' + marks[x].mph + 'mph  G' + (marks[x].gear + 1), x * cw + 5, plotH + 14);
    }
  }
  g.fillStyle = '#8fa9bd'; g.fillText(label, 6, plotH + 28);
}, { rows: cap.rows, marks: cap.marks, W, H, sampleRate: cap.sampleRate,
     label: `peak ${cap.peak}  rms ${cap.rms}  guitar ${cap.energy.guitar} dB  kick ${cap.energy.kick} dB` });
await page2.screenshot({ path: OUT });
await browser.close();

if (errs.length) fail.push('page errors: ' + errs.slice(0, 3).join(' | '));
console.log(fail.length ? 'FAIL\n  ' + fail.join('\n  ') : 'OK');
console.log('wrote ' + OUT + ' — now LOOK at it: a riff has vertical stripes on the beat and a moving fundamental');
process.exit(fail.length ? 1 : 0);
