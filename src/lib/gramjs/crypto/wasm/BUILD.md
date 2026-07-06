# Building the AES WASM core

`aes.wasm` is built from `aes.c` — a freestanding, dependency-free AES-256
core (T-tables, generated at runtime from an algorithmic S-box) with IGE and
CTR loop layers. No emscripten, no libc, no JS glue beyond
`src/lib/gramjs/crypto/aesWasm.ts`.

## Recipe

```bash
clang --target=wasm32 -O3 -nostdlib -ffreestanding -fvisibility=hidden \
  -mbulk-memory \
  -Wl,--no-entry -Wl,--stack-first -Wl,-z,stack-size=16384 \
  -Wl,--initial-memory=2097152 -Wl,--max-memory=2097152 \
  -o aes.wasm aes.c
```

Built with clang 22.1.5; any clang ≥ 15 with the `wasm32` backend works.
The output is ~8 KB.

## Design notes

- **Fixed, non-growable memory** (`--initial-memory == --max-memory`, 2 MiB):
  1 MiB I/O buffer + ~33 KB tables + 16 KB stack. No `memory.grow` means the
  JS-side heap view never detaches and the emscripten resizable-ArrayBuffer
  trap (see `src/lib/rlottie/BUILD.md`) cannot occur by construction.
  Payloads larger than the I/O buffer are processed in chained slices — the
  IGE IV state and the CTR counter/carry state persist in linear memory
  between calls.
- **`--stack-first`** places the (tiny) shadow stack below the data segments
  so a stack overflow traps instead of corrupting the tables.
- **Encrypt and decrypt directions** are both implemented: MTProto IGE
  decryption uses the AES inverse cipher (matching `@cryptography/aes`),
  while CTR only ever uses the forward cipher.
- **Bit-exactness** against the JS implementations (`@cryptography/aes` IGE
  and the carry-aware CTR in `../crypto.ts`) plus Node's OpenSSL
  `aes-256-ctr` as an independent oracle is verified by
  `perf/bench-aes.mjs`, including empty/16 B/1 MiB/multi-slice payloads and
  odd CTR chunk sequences. Run it after any change to `aes.c`:

```bash
node perf/bench-aes.mjs
```
