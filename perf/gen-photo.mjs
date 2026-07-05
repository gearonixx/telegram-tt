/*
 * Deterministically generates `src/lib/gramjs/client/__data__/perf-photo.png`
 * (1200×1500 RGBA, ~1.5 MB compressed, ~7.2 MB decoded) used by the `perf`
 * mock scenario as the payload for the synthetic photo-heavy channel.
 *
 * The file is generated (not committed) to keep the repo small. It is written
 * only if missing; delete it to regenerate. Runs automatically from
 * `perf/measure.mjs`, or manually: `node perf/gen-photo.mjs`.
 */

import { existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const WIDTH = 1200;
const HEIGHT = 1500;

export const PHOTO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/gramjs/client/__data__/perf-photo.png',
);

export function ensurePerfPhoto() {
  if (existsSync(PHOTO_PATH)) return PHOTO_PATH;
  writeFileSync(PHOTO_PATH, generatePng(WIDTH, HEIGHT));
  return PHOTO_PATH;
}

function generatePng(width, height) {
  // Raw image: per-row filter byte (0) + RGBA scanline.
  // Gradient + deterministic speckle so zlib lands near ~1.5 MB instead of
  // collapsing to a few KB (solid colors) or blowing up to raw size (noise).
  const raw = Buffer.alloc(height * (1 + width * 4));
  let seed = 0x9e3779b9;
  const rand = () => {
    // LCG (numerical recipes); deterministic across runs
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };

  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      // Speckle only every 4th row (LZ77 matches the identical rows between)
      // to land near a realistic ~0.5–1 MB compressed size for this resolution
      const noise = (y & 3) === 0 && (rand() & 3) === 0 ? rand() & 0xff : 0;
      raw[offset++] = (x >> 3) & 0xff ^ noise; // R
      raw[offset++] = (y >> 3) & 0xff; // G
      raw[offset++] = 128; // B
      raw[offset++] = 255; // A
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  const idatData = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = ensurePerfPhoto();
  console.log(`[perf] photo asset at ${path}`);
}
