#!/usr/bin/env node
/*
 * Bit-exactness + throughput harness for the WASM AES-256 core
 * (src/lib/gramjs/crypto/wasm/aes.wasm) against:
 *   - @cryptography/aes IGE (the implementation used by src/lib/gramjs/crypto/IGE.ts)
 *   - a verbatim replica of the carry-aware JS CTR from src/lib/gramjs/crypto/crypto.ts
 *   - Node's native OpenSSL aes-256-ctr as an independent oracle for CTR
 *
 * Usage: node perf/bench-aes.mjs [--bench-only]
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes, createCipheriv as nodeCreateCipheriv, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const aesPkg = require('@cryptography/aes');
const AES = aesPkg.default?.default ?? aesPkg.default ?? aesPkg;
const { IGE: JsIge } = aesPkg;

const { initAesWasmFromBytes, AesWasmCtr } = await import(
  join(rootDir, 'src/lib/gramjs/crypto/aesWasm.ts')
);
const wasm = await initAesWasmFromBytes(
  readFileSync(join(rootDir, 'src/lib/gramjs/crypto/wasm/aes.wasm')),
);

/* ---------- JS reference paths (mirroring the repo wrappers) ---------- */

// Mirrors convertToLittle() in src/lib/gramjs/Helpers.ts
function convertToLittle(buf) {
  const correct = new Uint8Array(buf.length * 4);
  const view = new DataView(correct.buffer);
  for (let i = 0; i < buf.length; i++) view.setUint32(i * 4, buf[i], false);
  return correct;
}

function jsIgeEncrypt(key, iv, data) {
  return convertToLittle(new JsIge(key, iv).encrypt(data));
}

function jsIgeDecrypt(key, iv, data) {
  return convertToLittle(new JsIge(key, iv).decrypt(data));
}

// Verbatim replica of the CTR class in src/lib/gramjs/crypto/crypto.ts
function writeU32WordsBE(words, out) {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i], false);
}

class RepoJsCtr {
  constructor(key, iv) {
    this._counter = new Uint8Array(iv);
    this._carryBlock = undefined;
    this._carryOffset = 0;
    this._aes = new AES(key);
  }

  _increment() {
    const counter = this._counter;
    for (let i = 15; i >= 0; i--) {
      if (counter[i] === 255) counter[i] = 0;
      else { counter[i]++; break; }
    }
  }

  update(src) {
    const n = src.length;
    const dst = new Uint8Array(n);
    let pos = 0;
    if (this._carryBlock) {
      const take = Math.min(16 - this._carryOffset, n);
      for (let j = 0; j < take; j++) dst[pos + j] = src[pos + j] ^ this._carryBlock[this._carryOffset + j];
      pos += take;
      this._carryOffset += take;
      if (this._carryOffset === 16) { this._carryBlock = undefined; this._carryOffset = 0; }
    }
    const keystream = new Uint8Array(16);
    while (pos + 16 <= n) {
      writeU32WordsBE(this._aes.encrypt(this._counter), keystream);
      this._increment();
      for (let j = 0; j < 16; j++) dst[pos + j] = src[pos + j] ^ keystream[j];
      pos += 16;
    }
    if (pos < n) {
      writeU32WordsBE(this._aes.encrypt(this._counter), keystream);
      this._increment();
      let used = 0;
      for (; pos < n; pos++, used++) dst[pos] = src[pos] ^ keystream[used];
      this._carryBlock = keystream;
      this._carryOffset = used;
    }
    return dst;
  }
}

/* ---------- Equality checks ---------- */

function hex(u8, max = 32) {
  return Buffer.from(u8.subarray(0, max)).toString('hex');
}

function assertEqual(name, a, b) {
  if (a.length !== b.length) {
    throw new Error(`${name}: length mismatch ${a.length} != ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${name}: byte ${i} differs (${a[i]} != ${b[i]}); a=${hex(a)} b=${hex(b)}`);
    }
  }
}

const IGE_SIZES = [0, 16, 32, 4096, 131072, 524288, 1048576, 2097168 /* > IO capacity: 3 chained slices */];
const CTR_CHUNKINGS = [
  [7, 9, 64, 1000],
  [1, 1, 1, 13, 3, 15, 16, 17, 31, 33],
  [16, 16, 16],
  [131072, 5, 131072],
  [1048576],
  [1048600, 7, 524288], // > IO capacity slice + odd tails
  [0, 16, 0, 7, 0, 9],
];

function runEqualityChecks() {
  console.log('== Bit-exactness: IGE (WASM vs @cryptography/aes) ==');
  for (const size of IGE_SIZES) {
    const key = new Uint8Array(randomBytes(32));
    const iv = new Uint8Array(randomBytes(32));
    const plain = new Uint8Array(randomBytes(size));

    const wasmCt = wasm.igeEncrypt(key, iv, plain);
    assertEqual(`ige-encrypt-${size}`, wasmCt, jsIgeEncrypt(key, iv, plain));

    const wasmPt = wasm.igeDecrypt(key, iv, wasmCt);
    assertEqual(`ige-decrypt-${size}`, wasmPt, jsIgeDecrypt(key, iv, wasmCt));
    assertEqual(`ige-roundtrip-${size}`, wasmPt, plain);
    console.log(`  ige ${String(size).padStart(7)} B: encrypt OK, decrypt OK, roundtrip OK`);
  }

  console.log('== Bit-exactness: CTR (WASM vs repo JS vs OpenSSL) across chunkings ==');
  for (const chunks of CTR_CHUNKINGS) {
    const key = new Uint8Array(randomBytes(32));
    const iv = new Uint8Array(randomBytes(16));
    const wasmCtr = new AesWasmCtr(wasm, key, iv);
    const jsCtr = new RepoJsCtr(key, iv);
    const nodeCtr = nodeCreateCipheriv('aes-256-ctr', key, iv);

    for (const [i, size] of chunks.entries()) {
      const data = new Uint8Array(randomBytes(size));
      const w = wasmCtr.update(data);
      const j = jsCtr.update(data);
      const n = new Uint8Array(nodeCtr.update(data));
      assertEqual(`ctr-[${chunks.join('+')}]-chunk${i}-vs-js`, w, j);
      assertEqual(`ctr-[${chunks.join('+')}]-chunk${i}-vs-openssl`, w, n);
    }
    console.log(`  ctr chunks [${chunks.join('+')}]: OK (vs repo JS and OpenSSL)`);
  }

  console.log('All equality checks PASSED\n');
}

/* ---------- Benchmarks ---------- */

function bench(label, sizeBytes, fn, minMs = 700) {
  fn(); fn(); // warmup
  let reps = 0;
  const start = performance.now();
  let elapsed = 0;
  while (elapsed < minMs) {
    fn();
    reps++;
    elapsed = performance.now() - start;
  }
  const mbps = (sizeBytes * reps) / 1e6 / (elapsed / 1000);
  return { label, mbps, reps };
}

async function runBench() {
  const sizes = [16384, 131072, 524288, 1048576];
  console.log('== Throughput (MB/s, single thread) ==');
  console.log('size      | ige-enc JS | ige-enc WASM | ige-dec JS | ige-dec WASM | ctr JS | ctr WASM | ctr subtle');
  for (const size of sizes) {
    const key = new Uint8Array(randomBytes(32));
    const iv32 = new Uint8Array(randomBytes(32));
    const iv16 = new Uint8Array(randomBytes(16));
    const data = new Uint8Array(randomBytes(size));

    const igeEncJs = bench('ige-enc-js', size, () => jsIgeEncrypt(key, iv32, data));
    const igeEncWasm = bench('ige-enc-wasm', size, () => wasm.igeEncrypt(key, iv32, data));
    const igeDecJs = bench('ige-dec-js', size, () => jsIgeDecrypt(key, iv32, data));
    const igeDecWasm = bench('ige-dec-wasm', size, () => wasm.igeDecrypt(key, iv32, data));

    const jsCtr = new RepoJsCtr(key, iv16);
    const ctrJs = bench('ctr-js', size, () => jsCtr.update(data));
    const wasmCtr = new AesWasmCtr(wasm, key, iv16);
    const ctrWasm = bench('ctr-wasm', size, () => wasmCtr.update(data));

    // WebCrypto AES-CTR reference (hardware AES, async API — not usable in the sync socket path)
    const subtleKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-CTR' }, false, ['encrypt']);
    let subtleMbps = 0;
    {
      const t0 = performance.now();
      let reps = 0;
      while (performance.now() - t0 < 700) {
        await webcrypto.subtle.encrypt({ name: 'AES-CTR', counter: iv16, length: 64 }, subtleKey, data);
        reps++;
      }
      subtleMbps = (size * reps) / 1e6 / ((performance.now() - t0) / 1000);
    }

    const row = [
      `${String(size / 1024).padStart(5)} KiB`,
      igeEncJs.mbps.toFixed(1).padStart(10),
      igeEncWasm.mbps.toFixed(1).padStart(12),
      igeDecJs.mbps.toFixed(1).padStart(10),
      igeDecWasm.mbps.toFixed(1).padStart(12),
      ctrJs.mbps.toFixed(1).padStart(6),
      ctrWasm.mbps.toFixed(1).padStart(8),
      subtleMbps.toFixed(1).padStart(10),
    ];
    console.log(row.join(' | '));
  }
}

if (!process.argv.includes('--bench-only')) {
  runEqualityChecks();
}
await runBench();
