# Building rlottie-wasm from source

`rlottie-wasm.js` / `rlottie-wasm.wasm` are built from the Telegram rlottie
fork with a 6-function C wrapper reproducing the ABI the previous (2020-era)
vendored binary exposed. The rebuild is **bit-exact** against the old binary:
identical `framesCount` and identical pixels (max channel delta 0 across
complex/gradient/static test stickers at 416×416) — verified by rendering the
same frames through both modules in Node and diffing buffers byte-for-byte.
The wrapper's SIMD BGRA→RGBA conversion keeps this bit-exactness by taking
the exact scalar path for mixed-alpha pixel groups (see below).

## Recipe

```bash
git clone --depth 1 https://github.com/emscripten-core/emsdk && cd emsdk
./emsdk install latest && ./emsdk activate latest && source emsdk_env.sh
# built with emcc 6.0.2

git clone --depth 1 https://github.com/TelegramMessenger/rlottie
sed -i 's/-Werror//g' rlottie/CMakeLists.txt   # modern clang trips 2019-era warnings

mkdir build && cd build
emcmake cmake ../rlottie -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DLOTTIE_MODULE=OFF -DLOTTIE_THREAD=OFF -DLOTTIE_TEST=OFF -DLOTTIE_EXAMPLE=OFF \
  -DCMAKE_CXX_FLAGS="-Oz -flto -fno-exceptions -msimd128 -msse2 -Wno-error" \
  -DCMAKE_C_FLAGS="-Oz -flto -fno-exceptions -msimd128 -msse2 -Wno-error"
make -j rlottie

em++ -Oz -flto -fno-exceptions -msimd128 -msse2 wrapper.cpp librlottie.a \
  -I../rlottie/inc -o rlottie-wasm.js \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sGROWABLE_ARRAYBUFFERS=0 \
  -sINITIAL_MEMORY=4194304 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=1048576 \
  -sEXPORTED_FUNCTIONS=_lottie_init,_lottie_destroy,_lottie_resize,_lottie_buffer,_lottie_render,_lottie_load_from_data,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 -sFILESYSTEM=0 -sMALLOC=emmalloc

# Last few KB: binaryen size pass over the linked module (ships in emsdk)
wasm-opt --all-features -Oz rlottie-wasm.wasm -o rlottie-wasm.wasm
```

## Why `-sGROWABLE_ARRAYBUFFERS=0` is required

emcc ≥ 6 defaults to backing the heap with a resizable `ArrayBuffer`
(`WebAssembly.Memory.toResizableBuffer`) where the engine supports it. The
worker's zero-copy render path constructs
`new ImageData(new Uint8ClampedArray(HEAPU8.buffer, ptr, len), …)`, and
`ImageData`'s WebIDL signature does not opt into `[AllowResizable]`, so
Chromium rejects it on **every frame**:

> Failed to construct 'ImageData': The provided Uint8ClampedArray value must
> not be resizable.

Node (25.x) has no `toResizableBuffer`, so Node-side validation cannot catch
this — it only reproduces in the browser. With the flag off, the glue uses
the classic buffer and re-creates `Module.HEAPU8` after every `memory.grow`
(`updateMemoryViews`), which is exactly the behavior the zero-copy path was
validated on.

## wrapper.cpp

Maps the ABI onto the rlottie C++ API and converts rlottie's premultiplied
ARGB output to the straight RGBA that `ImageData` expects. The conversion is
SIMD: fully-opaque pixel groups are a single byte shuffle, fully-transparent
groups store zero, and mixed-alpha groups (antialiased edges) take the exact
scalar integer `x * 255 / a` unpremultiply — so output stays bit-identical
to the old binary while the conversion (previously ~18 % of `lottie_render`
self-time in a V8 tick profile) mostly vanishes. Measured whole-render
effect at 416²: complex sticker 656 → 713 fps, medium 1008 → 1172 fps,
simple 5843 → 7463 fps versus the scalar-wrapper build.

```cpp
// Reimplementation of the 6-function C ABI used by telegram-tt's
// rlottie.worker.ts, linked against upstream rlottie built with -msimd128.
//
//   lottie_init() -> handle
//   lottie_load_from_data(handle, jsonPtr) -> framesCount
//   lottie_resize(handle, w, h)
//   lottie_buffer(handle) -> ptr to straight (non-premultiplied) RGBA pixels
//   lottie_render(handle, frameNo)
//   lottie_destroy(handle)

#include <rlottie.h>

#include <emscripten.h>
#include <wasm_simd128.h>

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace {

struct Player {
  std::unique_ptr<rlottie::Animation> anim;
  std::vector<uint32_t> premul;   // rlottie render target (premultiplied ARGB)
  std::vector<uint32_t> out;      // converted straight RGBA handed to JS
  size_t width = 0;
  size_t height = 0;
  size_t frames = 0;
};

std::map<int, Player> g_players;
int g_nextHandle = 1;

// Premultiplied ARGB32 (B,G,R,A bytes on little-endian) -> straight RGBA bytes.
inline uint32_t convertOnePixel(uint32_t px) {
  uint32_t a = px >> 24;
  if (a == 0) return 0;
  uint32_t r = (px >> 16) & 0xff;
  uint32_t g = (px >> 8) & 0xff;
  uint32_t b = px & 0xff;
  if (a != 255) {
    r = r * 255 / a;
    g = g * 255 / a;
    b = b * 255 / a;
  }
  return (a << 24) | (b << 16) | (g << 8) | r;
}

// SIMD fast paths for the two cases covering almost every sticker pixel:
// fully opaque (BGRA->RGBA is a single byte shuffle, no unpremultiply) and
// fully transparent (store zero). Mixed-alpha lanes (antialiased edges) take
// the exact scalar path, so output stays bit-identical to the scalar loop.
void convertToRgba(const uint32_t* src, uint32_t* dst, size_t n) {
  const v128_t alphaMask = wasm_i32x4_splat(static_cast<int>(0xff000000u));
  size_t i = 0;
  for (; i + 4 <= n; i += 4) {
    v128_t px = wasm_v128_load(src + i);
    v128_t alpha = wasm_v128_and(px, alphaMask);
    if (wasm_i32x4_all_true(wasm_i32x4_eq(alpha, alphaMask))) {
      wasm_v128_store(dst + i, wasm_i8x16_shuffle(px, px, 2, 1, 0, 3, 6, 5, 4, 7, 10, 9, 8, 11, 14, 13, 12, 15));
    } else if (!wasm_v128_any_true(alpha)) {
      wasm_v128_store(dst + i, wasm_i32x4_splat(0));
    } else {
      dst[i] = convertOnePixel(src[i]);
      dst[i + 1] = convertOnePixel(src[i + 1]);
      dst[i + 2] = convertOnePixel(src[i + 2]);
      dst[i + 3] = convertOnePixel(src[i + 3]);
    }
  }
  for (; i < n; i++) dst[i] = convertOnePixel(src[i]);
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int lottie_init() {
  g_players[g_nextHandle];
  return g_nextHandle++;
}

EMSCRIPTEN_KEEPALIVE void lottie_destroy(int handle) {
  g_players.erase(handle);
}

EMSCRIPTEN_KEEPALIVE int lottie_load_from_data(int handle, const char* data) {
  auto it = g_players.find(handle);
  if (it == g_players.end() || !data) return 0;
  static int uniq = 0;
  it->second.anim = rlottie::Animation::loadFromData(
      data, "tt-" + std::to_string(uniq++), "", /*cachePolicy=*/false);
  if (!it->second.anim) return 0;
  it->second.frames = it->second.anim->totalFrame();
  return static_cast<int>(it->second.frames);
}

EMSCRIPTEN_KEEPALIVE void lottie_resize(int handle, int width, int height) {
  auto it = g_players.find(handle);
  if (it == g_players.end() || width <= 0 || height <= 0) return;
  Player& p = it->second;
  p.width = static_cast<size_t>(width);
  p.height = static_cast<size_t>(height);
  p.premul.assign(p.width * p.height, 0);
  p.out.assign(p.width * p.height, 0);
}

EMSCRIPTEN_KEEPALIVE uint8_t* lottie_buffer(int handle) {
  auto it = g_players.find(handle);
  if (it == g_players.end()) return nullptr;
  return reinterpret_cast<uint8_t*>(it->second.out.data());
}

EMSCRIPTEN_KEEPALIVE void lottie_render(int handle, int frameNo) {
  auto it = g_players.find(handle);
  if (it == g_players.end()) return;
  Player& p = it->second;
  if (!p.anim || p.premul.empty()) return;
  rlottie::Surface surface(p.premul.data(), p.width, p.height, p.width * sizeof(uint32_t));
  p.anim->renderSync(static_cast<size_t>(frameNo), surface);
  convertToRgba(p.premul.data(), p.out.data(), p.width * p.height);
}

}  // extern "C"
```

## Why the Telegram fork

Samsung upstream (2025) reports `totalFrame = end - start + 1` (one more than
the old binary), renders visibly differently (5 years of AA/gradient drift)
and measures *slower* on complex stickers than the 2020-era build. The
Telegram fork matches the old binary exactly on all three counts — it is
evidently the original source of the vendored binary despite the README
crediting Samsung.

## What changed vs the old binary

- Initial WASM heap 16 MB → **4 MB** (1 MB stack; growth to 2 GB enabled).
- Emscripten glue 88 KB → **16.5 KB** (modern runtime, ES6-modularized).
- rlottie's hand-written SSE2 blend kernels compile to WASM SIMD via
  `-msse2 -msimd128`, and the wrapper's ARGB→RGBA conversion is vectorized:
  +9 % (complex) to +28 % (simple) whole-render throughput.
- Size pass: `-Oz -flto -fno-exceptions -sMALLOC=emmalloc` plus the
  `wasm-opt -Oz` post-pass measures within ±2 % of a plain `-O3` build on
  all three test stickers (still bit-exact), so the smaller build ships.
- Shipped bytes (brotli −q 11, what a server actually sends): wasm 129.8 KB
  + glue 4.8 KB = **134.7 KB**, vs 131.6 KB for the old module — +3.1 KB
  compressed buys SIMD rendering (+9–28 %) and the 12 MB-per-worker
  heap-floor drop. Raw: wasm 450 472 B, glue 16 163 B.
