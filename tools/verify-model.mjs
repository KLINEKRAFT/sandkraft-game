#!/usr/bin/env node
/* Load index.html in headless Chromium, assert the car is sane, and write a
   screenshot to look at. Used after tools/import-model.mjs.
     npm i playwright        # if it is not already there
     node tools/verify-model.mjs [out-dir]
   Exit code is non-zero if anything failed, so it can gate a commit. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = process.argv[2] || '.';
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
                '/opt/pw-browsers/chromium/chrome-linux/chrome']
  .find(p => existsSync(p));

const { chromium } = await import('playwright');
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 520 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('' + e.message));
page.on('console', m => {
  if (m.type() === 'error' && !/CONNECTION_RESET|ERR_/.test(m.text())) errs.push('console: ' + m.text());
});

await page.goto('file://' + resolve('index.html'));
let ready = false;
for (let i = 0; i < 45; i++) {
  ready = await page.evaluate(() => document.getElementById('go').classList.contains('ready'));
  if (ready) break;
  await page.waitForTimeout(700);
}

const info = await page.evaluate(() => ({
  carVerts: MESH.car.count, wheelVerts: MESH.wheel.count,
  wheelR: CARP.wheelR, track: Math.abs(CARP.mounts[0].x) * 2, wheelbase: Math.abs(CARP.mounts[0].z) * 2,
  restHeight: +(car.p.y - heightAt(car.p.x, car.p.z)).toFixed(3),
  contacts: car.contacts, upY: +car.up.y.toFixed(3)
}));

/* the cover orbit is the clearest look at the model */
await page.click('#go');
await page.waitForTimeout(1500);
await page.evaluate(() => { booting = true; coverBlend = 1; });
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(OUT, 'verify-orbit.png') });
await page.evaluate(() => { booting = false; coverBlend = 0; cam.mode = 0; cam.init = false; });
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(OUT, 'verify-chase.png') });
await browser.close();

const fail = [];
if (!ready) fail.push('never reached READY');
if (errs.length) fail.push('errors: ' + errs.slice(0, 4).join(' | '));
if (info.carVerts < 12) fail.push('car mesh is empty');
if (info.contacts < 4) fail.push(`only ${info.contacts} wheels touching — check the fit`);
if (info.upY < 0.9) fail.push(`resting tilted (up.y ${info.upY})`);
if (info.restHeight < 0.15 || info.restHeight > 1.6) fail.push(`odd ride height ${info.restHeight} m`);

console.log(JSON.stringify(info, null, 1));
console.log(fail.length ? 'FAIL\n  ' + fail.join('\n  ') : 'OK — now LOOK at verify-orbit.png before shipping');
process.exit(fail.length ? 1 : 0);
