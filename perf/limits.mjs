/*
 * Hardware-ceiling micro-benchmarks for the animated-sticker pipeline.
 *
 * Measures, on this machine, the throughput ceiling of every stage a sticker
 * frame passes through, so the app's real numbers in MEMORY_AUDIT.md can be
 * expressed as a percentage of what the hardware allows:
 *
 *   node side  — DRAM copy bandwidth (V8 typed-array memcpy)
 *              — rlottie WASM rasterizer throughput (the actual vendored
 *                binary driven natively in Node, real .tgs inputs)
 *   page side  — renderer-process memcpy
 *              — ImageData -> createImageBitmap snapshot rate
 *              — drawImage (2d) and transferFromImageBitmap (bitmaprenderer)
 *              — the full per-frame pipeline cycle
 *
 * Usage:
 *   node perf/limits.mjs           # node-side benches
 *   node perf/limits.mjs --page    # + page-side benches (launches Chromium)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';

const DIR = dirname(fileURLToPath(import.meta.url));
const RLOTTIE_DIR = join(DIR, '../src/lib/rlottie');
const OUT_DIR = join(DIR, 'out');
const WITH_PAGE = process.argv.includes('--page');

const BENCH_MS = 1500;
const SIZES = [416, 128]; // 208 px message sticker @ DPR 2; ~64 px custom emoji @ DPR 2
const TGS_FILES = ['SearchingDuck.tgs', 'LastSeen.tgs']; // complex / simple

const results = { startedAt: new Date().toISOString(), node: {}, page: undefined };

function report(name, value) {
  console.log(`${name.padEnd(52)} ${value}`);
}

// --- Node: DRAM copy bandwidth -------------------------------------------

function benchMemcpy() {
  const MB = 128;
  const src = new Uint8Array(MB * 1024 * 1024).fill(7);
  const dst = new Uint8Array(MB * 1024 * 1024);
  dst.set(src); // warmup
  let copied = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < BENCH_MS) {
    dst.set(src);
    copied += src.byteLength;
  }
  const gbps = copied / ((performance.now() - t0) / 1000) / 1e9;
  results.node.memcpyGBps = +gbps.toFixed(1);
  report('node memcpy (typed-array copy)', `${gbps.toFixed(1)} GB/s`);
}

// --- Node: rlottie WASM rasterizer ---------------------------------------

async function loadRlottie() {
  const glue = readFileSync(join(RLOTTIE_DIR, 'rlottie-wasm.js'), 'utf8')
    .replace(/^import wasmUrl.*$/m, '')
    .replace(/^var Module = \{ locateFile: \(\) => wasmUrl \};$/m, '')
    .replace(/export default Module;\s*/, '')
    .replace(/export \{ allocate, intArrayFromString \};\s*/, ';return { Module, allocate, intArrayFromString };');
  // eslint-disable-next-line no-new-func
  const factory = new Function('Module', glue);
  let onReady;
  const ready = new Promise((resolve) => { onReady = resolve; });
  const wasmBinary = readFileSync(join(RLOTTIE_DIR, 'rlottie-wasm.wasm'));
  const exportsObj = factory({ wasmBinary, onRuntimeInitialized: () => onReady() });
  await ready;
  const { Module, allocate, intArrayFromString } = exportsObj;
  const api = {
    init: Module.cwrap('lottie_init', '', []),
    destroy: Module.cwrap('lottie_destroy', '', ['number']),
    resize: Module.cwrap('lottie_resize', '', ['number', 'number', 'number']),
    buffer: Module.cwrap('lottie_buffer', 'number', ['number']),
    render: Module.cwrap('lottie_render', '', ['number', 'number']),
    loadFromData: Module.cwrap('lottie_load_from_data', 'number', ['number', 'number']),
  };
  return { Module, allocate, intArrayFromString, api };
}

async function benchRasterizer() {
  const { Module, allocate, intArrayFromString, api } = await loadRlottie();
  results.node.rasterizer = [];
  for (const tgs of TGS_FILES) {
    const json = gunzipSync(readFileSync(join(DIR, '../src/assets/tgs', tgs))).toString();
    const ptr = allocate(intArrayFromString(json), 'i8', 0);
    const handle = api.init();
    const framesCount = api.loadFromData(handle, ptr);
    Module._free(ptr);
    for (const size of SIZES) {
      api.resize(handle, size, size);
      for (let f = 0; f < Math.min(framesCount, 16); f++) api.render(handle, f); // warmup
      let rendered = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < BENCH_MS) {
        api.render(handle, rendered % framesCount);
        rendered++;
      }
      const secs = (performance.now() - t0) / 1000;
      const fps = rendered / secs;
      const mbps = (fps * size * size * 4) / 1e6;
      const nsPerPx = (secs * 1e9) / (rendered * size * size);
      results.node.rasterizer.push({
        tgs, size, framesCount, fps: +fps.toFixed(1), MBps: +mbps.toFixed(0), nsPerPixel: +nsPerPx.toFixed(2),
      });
      report(`rlottie render ${tgs} @ ${size}px`, `${fps.toFixed(1)} fps  ${mbps.toFixed(0)} MB/s  ${nsPerPx.toFixed(1)} ns/px`);
    }
    api.destroy(handle);
  }
}

// --- Page: renderer-process ceilings --------------------------------------

async function benchPage() {
  const { chromium } = await import('@playwright/test');
  const executablePath = process.env.PERF_CHROME || '/usr/bin/chromium';
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  results.page = await page.evaluate(async (BENCH) => {
    const out = {};
    const SIZE = 416;

    { // memcpy
      const src = new Uint8Array(64 * 1024 * 1024).fill(7);
      const dst = new Uint8Array(64 * 1024 * 1024);
      dst.set(src);
      let copied = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < BENCH) { dst.set(src); copied += src.byteLength; }
      out.memcpyGBps = +(copied / ((performance.now() - t0) / 1000) / 1e9).toFixed(1);
    }

    const imageData = new ImageData(SIZE, SIZE);
    for (let i = 0; i < imageData.data.length; i++) imageData.data[i] = (i * 2654435761) & 0xff;

    { // ImageData -> ImageBitmap snapshot
      let n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < BENCH) { (await createImageBitmap(imageData)).close(); n++; }
      const secs = (performance.now() - t0) / 1000;
      out.createImageBitmap = { fps: +(n / secs).toFixed(0), MBps: +((n / secs) * SIZE * SIZE * 4 / 1e6).toFixed(0) };
    }

    const bmp = await createImageBitmap(imageData);

    { // drawImage to 2d canvas
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      let n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < BENCH) { ctx.drawImage(bmp, 0, 0); n++; }
      ctx.getImageData(0, 0, 1, 1); // force queue flush
      const secs = (performance.now() - t0) / 1000;
      out.drawImage2d = { fps: +(n / secs).toFixed(0), MBps: +((n / secs) * SIZE * SIZE * 4 / 1e6).toFixed(0) };
    }

    { // transferFromImageBitmap (bitmaprenderer)
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('bitmaprenderer');
      let n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < BENCH) {
        const b = await createImageBitmap(imageData);
        ctx.transferFromImageBitmap(b);
        n++;
      }
      const secs = (performance.now() - t0) / 1000;
      out.bitmaprendererCycle = { fps: +(n / secs).toFixed(0), MBps: +((n / secs) * SIZE * SIZE * 4 / 1e6).toFixed(0) };
    }

    { // full 2d pipeline cycle: snapshot + draw + close
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      let n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < BENCH) {
        const b = await createImageBitmap(imageData);
        ctx.drawImage(b, 0, 0);
        b.close();
        n++;
      }
      const secs = (performance.now() - t0) / 1000;
      out.fullCycle2d = { fps: +(n / secs).toFixed(0), MBps: +((n / secs) * SIZE * SIZE * 4 / 1e6).toFixed(0) };
    }

    return out;
  }, BENCH_MS);
  await browser.close();

  report('page memcpy', `${results.page.memcpyGBps} GB/s`);
  for (const [k, v] of Object.entries(results.page)) {
    if (typeof v === 'object') report(`page ${k} @416px`, `${v.fps} fps  ${v.MBps} MB/s`);
  }
}

benchMemcpy();
await benchRasterizer();
if (WITH_PAGE) await benchPage();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'limits.json'), JSON.stringify(results, undefined, 2));
console.log(`\nSaved to perf/out/limits.json`);
