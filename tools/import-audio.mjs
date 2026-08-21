#!/usr/bin/env node
/* Embed a recorded track into index.html as an extra radio station.

     node tools/import-audio.mjs assets/track.ogg --name=doom --label="DOOM FM"
     node tools/import-audio.mjs --list
     node tools/import-audio.mjs --name=doom --remove

   The soundtrack in the game is generated, because a single file with no
   fetches cannot afford a few megabytes of audio and a loop repeats where a
   generator does not. But if you have a track you are licensed to ship, this
   puts it on the dial beside the synthesised ones: it becomes another station
   the RADIO button cycles to, decoded once on selection and looped.

   Budget honestly. The file is base64'd into the HTML, which costs 33% on top
   of whatever it already weighs, and index.html is currently under a megabyte
   in total. A three-minute stereo MP3 at 128 kbps is 2.9 MB and lands at 3.9 MB
   here — four times the size of the entire rest of the game. A 30-second loop
   at 96 kbps mono is about 480 KB, which is a real thing to consider. Opus in
   an .ogg or .webm container gets you the same quality at roughly half that,
   and every browser that can run this engine can decode it.

   Formats: whatever the browser's decodeAudioData accepts — mp3, ogg/opus,
   webm, m4a, wav. There is no decoding here; the bytes are passed through.

   No dependencies. */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const flag = k => args.includes('--' + k);
const HTML = opt('html', 'index.html');
const B = '/* ===IMPORTED-AUDIO-BEGIN=== */', E = '/* ===IMPORTED-AUDIO-END=== */';
const MIME = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
               '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
               '.flac': 'audio/flac' };

let html = readFileSync(HTML, 'utf8');
const i = html.indexOf(B), j = html.indexOf(E);
if (i < 0 || j < 0) throw new Error('no IMPORTED-AUDIO block in ' + HTML);
const m = html.slice(i + B.length, j).match(/const\s+IMPORTED_AUDIO\s*=\s*([\s\S]*?);\s*$/);
const table = m ? JSON.parse(m[1]) : {};
const write = () => {
  const body = `const IMPORTED_AUDIO = ${JSON.stringify(table)};`;
  writeFileSync(HTML, html.slice(0, i + B.length) + '\n' + body + '\n' + html.slice(j));
  const kb = k => (k / 1024).toFixed(0) + ' KB';
  console.log(`wrote ${HTML}: ${Object.keys(table).length} track(s), ${kb(body.length)} of audio, ` +
              `${kb(statSync(HTML).size)} total`);
};

if (flag('list')) {
  const rows = Object.keys(table).map(n => ({
    name: n, label: table[n].label, type: table[n].type, gain: table[n].gain,
    kb: +(table[n].data.length / 1024).toFixed(0), source: table[n].source
  }));
  if (rows.length) console.table(rows); else console.log('no tracks imported');
  process.exit(0);
}

const NAME = opt('name', null);
if (!NAME) { console.error('usage: import-audio.mjs <file> --name=ID [--label="TEXT"] [--gain=1]'); process.exit(1); }
if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(NAME)) throw new Error('--name must be a plain identifier: ' + NAME);

if (flag('remove')) {
  if (!table[NAME]) { console.log(`no track named ${NAME}`); process.exit(0); }
  delete table[NAME];
  write();
  process.exit(0);
}

const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('no audio file given'); process.exit(1); }
const ext = extname(file).toLowerCase();
const type = MIME[ext];
if (!type) throw new Error(`no MIME type known for ${ext} — supported: ${Object.keys(MIME).join(' ')}`);

const bytes = readFileSync(file);
const data = bytes.toString('base64');
/* The station label is what the RADIO button shows, and that button is 9.5 px
   type on a phone — anything past about eight characters wraps the tool row. */
const label = (opt('label', basename(file, ext)) || NAME).toUpperCase().slice(0, 8);

table[NAME] = { data, type, gain: +opt('gain', 1), label, source: basename(file) };

console.log(`${file}: ${(bytes.length / 1024).toFixed(0)} KB -> ${(data.length / 1024).toFixed(0)} KB base64` +
            ` (+${((data.length / bytes.length - 1) * 100).toFixed(0)}%)`);
console.log(`  station "${label}", gain ${table[NAME].gain}`);
if (data.length > 1.5e6)
  console.log('  *** this one track is bigger than the rest of the game put together —' +
              ' consider a shorter loop, or Opus at 96 kbps mono ***');
if (flag('dry')) { console.log('--dry: nothing written'); process.exit(0); }
write();
console.log('the RADIO button now cycles through it; run tools/verify-audio.mjs --station=' +
            (4 + Object.keys(table).indexOf(NAME)) + ' to check it decodes');
