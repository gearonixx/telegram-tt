/*
 * Loader and thin wrappers for the vendored freestanding AES-256 WASM core
 * (see wasm/aes.c and wasm/BUILD.md). Instantiation is lazy and asynchronous;
 * until it settles (or if it fails) callers keep using the pure-JS
 * implementations, so the WASM path is a transparent fast path only.
 *
 * This module is intentionally dependency-free: perf/bench-aes.mjs loads it
 * directly in Node to prove bit-exactness against the JS implementations.
 */

type AesWasmExports = {
  memory: WebAssembly.Memory;
  expandKey: (withDec: number) => void;
  igeEncrypt: (len: number) => void;
  igeDecrypt: (len: number) => void;
  ctrRun: (len: number) => void;
  getIo: () => number;
  getKey: () => number;
  getIv: () => number;
  getCtrState: () => number;
  getIoCapacity: () => number;
};

const KEY_SIZE = 32;
const IGE_IV_SIZE = 32;
const CTR_STATE_SIZE = 36; // Counter (16) + carry keystream (16) + carry offset (u32)

export class AesWasm {
  private exports: AesWasmExports;

  // The module's memory is non-growable, so a single view never detaches
  private heap: Uint8Array;

  private ioPtr: number;
  private keyPtr: number;
  private ivPtr: number;
  private ctrStatePtr: number;
  private ioCapacity: number;

  constructor(exports: AesWasmExports) {
    this.exports = exports;
    this.heap = new Uint8Array(exports.memory.buffer);
    this.ioPtr = exports.getIo();
    this.keyPtr = exports.getKey();
    this.ivPtr = exports.getIv();
    this.ctrStatePtr = exports.getCtrState();
    this.ioCapacity = exports.getIoCapacity();
  }

  // `data.length` must be a multiple of 16; enforced by callers
  igeEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
    return this.processIge(false, key, iv, data);
  }

  igeDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
    return this.processIge(true, key, iv, data);
  }

  // `state` is the caller-owned 36-byte CTR state blob; updated in place
  ctrUpdate(key: Uint8Array, state: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const {
      exports, heap, ioPtr, ioCapacity,
    } = this;

    heap.set(key.subarray(0, KEY_SIZE), this.keyPtr);
    exports.expandKey(0);
    heap.set(state, this.ctrStatePtr);

    const out = new Uint8Array(data.length);
    for (let offset = 0; offset < data.length; offset += ioCapacity) {
      const slice = data.subarray(offset, Math.min(offset + ioCapacity, data.length));
      heap.set(slice, ioPtr);
      exports.ctrRun(slice.length);
      out.set(heap.subarray(ioPtr, ioPtr + slice.length), offset);
    }

    state.set(heap.subarray(this.ctrStatePtr, this.ctrStatePtr + CTR_STATE_SIZE));
    return out;
  }

  private processIge(isDecrypt: boolean, key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const {
      exports, heap, ioPtr, ioCapacity,
    } = this;

    heap.set(key.subarray(0, KEY_SIZE), this.keyPtr);
    exports.expandKey(isDecrypt ? 1 : 0);
    heap.set(iv.subarray(0, IGE_IV_SIZE), this.ivPtr);

    const out = new Uint8Array(data.length);
    // The core chains the IGE state through IVBUF, so payloads larger than
    // the IO buffer are processed in block-aligned slices
    for (let offset = 0; offset < data.length; offset += ioCapacity) {
      const slice = data.subarray(offset, Math.min(offset + ioCapacity, data.length));
      heap.set(slice, ioPtr);
      if (isDecrypt) {
        exports.igeDecrypt(slice.length);
      } else {
        exports.igeEncrypt(slice.length);
      }
      out.set(heap.subarray(ioPtr, ioPtr + slice.length), offset);
    }

    return out;
  }
}

// Stateful AES-256-CTR stream backed by the WASM core; mirrors the carry
// semantics of the JS `CTR` class in crypto.ts
export class AesWasmCtr {
  private wasm: AesWasm;

  private key: Uint8Array;

  private state: Uint8Array;

  constructor(wasm: AesWasm, key: Uint8Array, iv: Uint8Array) {
    this.wasm = wasm;
    this.key = new Uint8Array(key);
    this.state = new Uint8Array(CTR_STATE_SIZE);
    this.state.set(iv);
  }

  update(data: Uint8Array): Uint8Array<ArrayBuffer> {
    return this.wasm.ctrUpdate(this.key, this.state, data);
  }
}

let instance: AesWasm | undefined;
let isLoadStarted = false;

export function getAesWasm(): AesWasm | undefined {
  return instance;
}

// Kicks off (once) the async instantiation of the vendored binary.
// Never throws: on any failure the JS implementations remain in use.
export function ensureAesWasm() {
  if (isLoadStarted) return;
  isLoadStarted = true;

  loadFromUrl().catch(() => {
    // Ignore and keep the JS fallback
  });
}

export async function initAesWasmFromBytes(bytes: BufferSource): Promise<AesWasm> {
  const result = await WebAssembly.instantiate(bytes, {});
  instance = new AesWasm(result.instance.exports as unknown as AesWasmExports);
  return instance;
}

async function loadFromUrl() {
  const response = await fetch(new URL('./wasm/aes.wasm', import.meta.url));
  if (!response.ok) return;
  await initAesWasmFromBytes(await response.arrayBuffer());
}
