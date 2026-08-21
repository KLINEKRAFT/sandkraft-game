/* Minimal PNG decoder, so the character importer can bake a baseColor texture
   down to vertex colours without a dependency. Node ships zlib, which is the
   only hard part; the rest is the scanline filters.

   Handles 8-bit greyscale / RGB / palette / greyscale+alpha / RGBA, which is
   everything Blender's glTF exporter emits. Interlaced PNGs are rejected
   rather than decoded wrong. */
import { inflateSync } from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, ihdr = null, palette = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8],
               color: data[9], interlace: data[12] };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('PNG has no IHDR');
  if (ihdr.interlace) throw new Error('interlaced PNG — re-save without Adam7 interlacing');
  if (ihdr.depth !== 8) throw new Error(`PNG is ${ihdr.depth}-bit; only 8-bit is handled`);
  const ch = CHANNELS[ihdr.color];
  if (!ch) throw new Error('unsupported PNG colour type ' + ihdr.color);

  const raw = inflateSync(Buffer.concat(idat));
  const { w, h } = ihdr;
  const bpp = ch;                       /* bytes per pixel in the filtered data */
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);

  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {                                       /* Paeth */
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad PNG filter ' + filter + ' on row ' + y);
      }
      cur[x] = v & 255;
    }
  }

  /* normalise everything to RGB8 — alpha is irrelevant to a vertex colour */
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    let r, g, b;
    if (ihdr.color === 3) {
      const pi = out[i] * 3;
      r = palette[pi]; g = palette[pi + 1]; b = palette[pi + 2];
    } else if (ihdr.color === 0 || ihdr.color === 4) {
      r = g = b = out[i * ch];
    } else {
      r = out[i * ch]; g = out[i * ch + 1]; b = out[i * ch + 2];
    }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  return { width: w, height: h, rgb };
}

/* Bilinear sample in 0..1 UV space, glTF convention (v runs down from the top).
   Returns linear-ish 0..1 floats; the game's colours are authored in the same
   loose sRGB-as-linear space the rest of the meshes use, so no conversion. */
export function sampleRGB(img, u, v) {
  const { width: w, height: h, rgb } = img;
  let x = (u - Math.floor(u)) * w - 0.5, y = (v - Math.floor(v)) * h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const cl = (a, n) => a < 0 ? 0 : (a >= n ? n - 1 : a);
  const o = (xx, yy) => (cl(yy, h) * w + cl(xx, w)) * 3;
  const a = o(x0, y0), b = o(x0 + 1, y0), c = o(x0, y0 + 1), d = o(x0 + 1, y0 + 1);
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const top = rgb[a + k] * (1 - fx) + rgb[b + k] * fx;
    const bot = rgb[c + k] * (1 - fx) + rgb[d + k] * fx;
    out[k] = (top * (1 - fy) + bot * fy) / 255;
  }
  return out;
}
