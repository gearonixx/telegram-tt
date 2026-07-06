# Telegram Web A — Memory Audit

Where the RAM goes in a media-heavy session, with evidence, and what was done
about it. All line references are against master `eb9f746` (the audit
baseline); measurements come from the reproducible harness in `perf/`
(mocked scenario, Chromium headless, 1440×900 @ deviceScaleFactor 2, dev
server). Branch: `memory-optimizations`.

## TL;DR

A single viewport of a sticker-and-custom-emoji-heavy channel at DPR 2 holds
**~280 MB of decoded RLottie frames** (`ImageBitmap`s), because high-priority
players cache ~75 % of their loop and low-priority players cache **100 % of
their loop and never release it, even while paused offscreen**. On top of
that, every media blob ever downloaded (photos, stickers, previews) is pinned
forever by an object URL in `mediaLoader`'s `memoryCache` — the app has an
`unload()` for it that **no code calls** — duplicating Cache Storage byte for
byte. These two mechanisms — decoded animation frames and immortal blobs —
account for the bulk of the "500 MB+ tab" reports; the global message store
and the GramJS worker entity cache add a slower, unbounded tail.

**Outcome** (nine commits, same scenario re-measured): steady-state frame
cache **285.6 → 8.9 MB**, worker WASM heaps **67.1 → 16.0 MB** at boot
(23.4 MB under load), renderer PSS **1200.6 → 803.1 MB (−33 %)**, whole
process tree **1580.6 → 1091.5 MB (−31 %)**; media blobs capped by a 64 MB
LRU; rlottie-wasm rebuilt from source with SIMD (+9–28 % render throughput,
bit-exact, 134.7 KB brotli shipped). Details in §5; WASM internals, the
emcc-6 resizable-buffer trap and the hardware-ceiling analysis in §6.

## 1. Architecture recon (memory-relevant subsystems)

- **Global state** (`src/global/`): single immutable-ish store updated by
  reducers. Messages live in `messages.byChatId[chatId].byId` and are merged,
  never trimmed, by `addChatMessagesById` (`reducers/messages.ts:178`);
  per-thread `listedIds` grows monotonically (`updateListedIds`,
  `reducers/messages.ts:492`). Only the *tab-scoped* `viewportIds` window is
  capped, at `MESSAGE_LIST_VIEWPORT_LIMIT = 120` (`config.ts:87`,
  `addViewportId`, `reducers/messages.ts:544`). What is *persisted* to
  IndexedDB is a reduced copy (users capped at 500, chats at 200 —
  `cache.ts`), but the *runtime* heap copy is never reduced.
- **Media lifecycle** (`src/util/mediaLoader.ts`): download (GramJS worker,
  transferred `ArrayBuffer`) → `Blob` → `URL.createObjectURL` →
  `memoryCache` (Map, session-lifetime) *and* Cache Storage (`tt-media`).
  Object URLs are created in `prepareMedia` (`mediaLoader.ts:271`) and only
  ever revoked in the opus-to-wav conversion path. `unload()`
  (`mediaLoader.ts:249`) is exported but has **zero callers**. Consumers read
  through `useMedia` (`src/hooks/useMedia.ts`), which re-reads
  `getFromMemory` on every render and re-fetches when absent — this is what
  makes eviction safe.
- **Animated stickers / custom emoji** (`src/lib/rlottie/`): `RLottie`
  renders via 4 media workers (`launchMediaWorkers.ts`, `MAX_WORKERS = 4`),
  each holding a WASM module with a 16 MB initial heap (64 MB floor,
  measured). Frames come back as `ImageBitmap`s sized
  `size × dpr × quality` px (`calcSizeFactor`, `RLottie.ts:352`) — a 208 px
  message sticker at DPR 2 is 416×416 = **692 KB per frame**. Playback caches
  frames per instance in `this.frames`: high-priority drops one frame every
  `cacheModulo = 4` (`RLottie.ts:507`), i.e. retains ~75 % of the loop;
  low-priority (`LOW_PRIORITY_CACHE_MODULO = 0`, `RLottie.ts:35`) retains
  100 %. `pause()` releases frames **only for high-priority** instances
  (`RLottie.ts:199`); offscreen pausing itself works (IntersectionObserver →
  `AnimatedSticker.tsx:252`). Two smaller defects: dropped frames were nulled
  without `ImageBitmap.close()` (`cleanupPrevFrame`, `RLottie.ts:607`), and a
  per-instance `this.imageData` (`RLottie.ts:60,296,326`) is allocated and
  never read — pure dead weight (692 KB per message sticker at DPR 2). In the
  worker, the animation JSON is copied onto the WASM heap and **never freed**
  (`rlottie.worker.ts:46-48,73-75`).
- **List rendering** (`src/components/middle/MessageList.tsx`): windowed by
  `viewportIds` (≤ 120 messages, `MESSAGE_LIST_SLICE = 60`); DOM and listener
  counts track the window and return to baseline on chat switch (measured).
  No DOM leak.
- **Workers**: the GramJS worker keeps `localDb` — plain Records of GramJS
  class instances for every chat/user/document/photo/sticker-set ever seen
  (`src/api/gramjs/localDb.ts:29-39`); cleared only on logout
  (`clearLocalDb`). Update handling is transient.
- **Existing utilities reused**: `DEBUG`-gated globals, mock client
  (`APP_MOCKED_CLIENT`) + invoke middlewares, `getGlobal` debug hook. The
  harness adds `__rlottieStats`, `__mediaCacheStats`, `__rlottieWasmStats`.

## 2. Measurement protocol

One scenario, every number reproducible (see `perf/README.md`):

| Checkpoint | State |
|---|---|
| S0 | cold load, idle 20 s |
| S1 | 5 media-heavy chats opened sequentially |
| S2 | ~300 messages scrolled back in the sticker/emoji channel |
| S2m | ~200 messages scrolled back in the photo channel (~540 KB each) |
| S3 | media viewer opened/closed 10× on different photos |
| S4 | back to first chat, idle 3 min, sampled every 15 s |

Recorded per checkpoint after double GC: JS heap (CDP `Performance`),
DOM nodes / listeners, live object URLs + bytes (patched
`URL.createObjectURL`), RLottie frame cache, media memory cache, canvas
backing bytes, global-store sizes, worker WASM heaps and `localDb` sizes,
per-process RSS/PSS from `/proc`, S4 heap snapshot with detached-node count.

Run: `npm run dev:mocked`, then
`node perf/measure.mjs --label baseline --snapshots`.

## 3. Diagnosis — hypothesis verdicts

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | Grow-only global store | **Confirmed** (moderate) | `addChatMessagesById` merges only (`reducers/messages.ts:178-191`); `listedIds` append-only (`:492-511`); only `viewportIds` capped (`:556-563`). Store messages grew 121 → 421 over the scenario with no path down except deletes. |
| 2 | Unrevoked object URLs / Blobs pinned in JS | **Confirmed** (major, unbounded) | `memoryCache.set` on every fetch (`mediaLoader.ts:147,176` orig); `unload()` has zero callers (grep); nothing revokes message-media URLs. Measured: 58 URLs / 26.5 MB after a 60-photo scroll; grows linearly with browsing, session-lifetime. |
| 3 | Lottie/WASM players alive offscreen, no cap | **Confirmed** (dominant) | Offscreen *pausing* works (`StickerView.tsx:110-120` → `AnimatedSticker.tsx:252-258`), but `pause()` frees frames only for high-priority (`RLottie.ts:199`); low-priority (custom emoji) cache 100 % of the loop (`LOW_PRIORITY_CACHE_MODULO = 0`) and keep it while paused. Measured: one viewport at DPR 2 = 675 frames / **283 MB**; no global cap of any kind. WASM heaps: fixed 4×16 MB floor. |
| 4 | Incomplete list virtualization | **Falsified** | `viewportIds` capped at 120 (`reducers/messages.ts:556`); measured 60–120 messages / 2.4–11.4 K DOM nodes, returning to ~2.7 K after switching; listeners track DOM exactly. |
| 5 | Media duplicated across layers | **Confirmed** (by design, one layer removable) | Same bytes exist as Cache Storage entry, JS `Blob` behind an object URL (browser-process blob storage), and decoded image. The JS copy is redundant after first paint — Cache Storage re-fetch is ~ms (`fetchFromCacheOrRemote` hits cache first). |
| 6 | Worker-side accumulation never compacted | **Confirmed** (moderate, not fixed here) | `localDb` Records of GramJS class instances, grow-only (`localDb.ts:29-39`), cleared only on logout (`:139`). Every message with media adds a `Document`/`Photo` instance. Bounding it risks MTProto behavior (`accessHash`/`fileReference` reuse), which this task forbids — documented for upstream. |
| 7 | Listener/closure leaks retaining big structures | **Falsified** (as a major factor) | JS listeners 113→263 strictly track mounted DOM and return on unmount; S4 idle samples flat after GC; S4 heap snapshot detached-node count reported by the harness stayed low (see `perf/out/`). |
| 8 | Oversized canvases / unclosed `ImageBitmap`s / full-res decodes | **Confirmed (bitmaps), partially (canvases)** | `cleanupPrevFrame` nulled slots without `close()` (`RLottie.ts:607-614`); `onFrameLoad` could store a bitmap into a cleared instance and orphan it (`:617`). Canvas backing stores are `(css × dpr)²×4` — measured 10–30 MB per viewport at DPR 2, bounded by virtualization (inherent cost, not a leak). Message-list photos decode at the requested `x` size, not full-res (verified in mock; full-res only in the viewer). |

Additional findings beyond the original list:

- **Dead `imageData` allocation**: 692 KB × every message-sticker instance at
  DPR 2, never read (`RLottie.ts:60,296,326,381`).
- **WASM heap leak**: every animation (re)load leaks its JSON string on the
  worker WASM heap (`rlottie.worker.ts:46-48,73-75`) — 50–200 KB per load,
  permanent, forces heap growth in long sticker-heavy sessions.
- **Fixed worker floor**: 4 media workers × 16 MB WASM initial memory + a
  GramJS worker ≈ 70 MB before any content. Lazy worker spawn would defer
  most of it; not implemented (used by many features early).

## 4. Ranked optimization plan (MB saved per unit of effort)

Savings measured on the S0–S4 scenario at DPR 2 unless marked *est.*

| Rank | Optimization | Root cause | Files | MB saved | Effort | Risk | Verified by |
|---|---|---|---|---|---|---|---|
| 1 | Bound RLottie frame cache: full-loop caching only when the loop fits `MAX_LOOP_CACHE_BYTES` (2 MB) *and* a global `FRAME_CACHE_GLOBAL_BUDGET` (32 MB); otherwise a 5-frame sliding window; release frames on pause for *all* priorities; `close()` every dropped bitmap | Unbounded per-loop `ImageBitmap` caching (H3/H8) | `src/lib/rlottie/RLottie.ts` | **see §5** (frame cache 65–283 MB → single-digit) | S | Medium-low: heavy loops re-render each cycle (CPU↑ on sticker-dense viewports; workers already do this for 25 % of high-priority frames) | S2/S4 `rlottie` counters + renderer PSS + visual smoothness |
| 2 | LRU byte budget for `mediaLoader.memoryCache` (`MEDIA_MEMORY_CACHE_MAX_BYTES = 64 MB`), revoke evicted object URLs, delete-on-unload | Immortal blobs duplicating Cache Storage (H2/H5) | `src/util/mediaLoader.ts`, `src/config.ts` | **see §5** (blob growth capped at budget; was unbounded) | S | Low: `useMedia` re-reads the cache every render and re-fetches on miss; evicted URLs self-heal on next render; budget `0` disables | S2m/S4 blob counters + browser-process PSS |
| 3 | Remove dead per-instance `imageData` | Dead allocation (H8+) | `src/lib/rlottie/RLottie.ts` | ~0.7 MB × visible message stickers (2–8 MB typical) | S | None (never read) | code + tsc |
| 4 | Free the animation JSON on the WASM heap after `loadFromData` | Permanent WASM heap leak | `src/lib/rlottie/rlottie.worker.ts`, `rlottie-wasm.d.ts` | 50–200 KB × every animation ever shown (tens of MB in long sessions, *est.*) | S | Low: rlottie parses into its own structures during `loadFromData`; freeing the input afterwards is the documented pattern | `wasmHeapBytes` flat across S0→S4 |
| 5 | *(not implemented)* Evict `messages.byChatId` slices + `listedIds` for chats closed > N minutes, keeping the persisted-cache subset | Grow-only store (H1) | `src/global/reducers/messages.ts`, new scheduler | 5–30 MB per heavy session (*est.*) | M | Medium-high: selectors assume presence; focus/reply jumps re-fetch | store-size counter at S4 |
| 6 | *(not implemented — API layer, out of scope by task rules)* Bound worker `localDb.documents/photos/messages` with LRU keyed by access | Grow-only entity cache (H6) | `src/api/gramjs/localDb.ts` | 10–50 MB per heavy session (*est.*) | M | High: `accessHash`/`fileReference` reuse; needs refetch-on-miss plumbing | worker `localDb` counters |
| 7 | *(not implemented)* Lazy-spawn media workers on first use | 64 MB WASM floor | `src/util/launchMediaWorkers.ts` | up to ~48 MB on text-only sessions (*est.*) | S | Medium: cold-start jank on first sticker | S0 total PSS |

## 5. Implemented optimizations and before/after

Isolated commits on `memory-optimizations`, measured on the identical
scenario (`perf/out/baseline.json` vs `perf/out/after-wasm.json`; the
intermediate `after.json` run isolates commits 2–5 before the WASM floor
patch, and `after-simd.json` measures the final state with the source
rebuild, commits 7–9).

1. `[Dev] Perf: Add memory measurement harness, mock scenario and debug counters`
2. `[Perf] RLottie: Bound the decoded-frame cache` *(rank 1 + 3)*
3. `[Perf] RLottie: Free the animation JSON copied to the WASM heap` *(rank 4)*
4. `[Perf] Media: Evict the in-memory media cache with an LRU byte budget` *(rank 2)*
5. `[Perf] RLottie: Render frames zero-copy from the WASM buffer` — the worker
   copied every rendered frame from the WASM heap into a persistent
   per-renderer `ImageData` before `createImageBitmap` copied it again; the
   `ImageData` now wraps the rlottie output buffer directly (see §6.1),
   removing the standing allocation (692 KB per 208 px renderer at DPR 2) and
   one full-frame copy per frame.
6. `[Perf] RLottie: Lower the initial WASM heap from 16 MB to 6 MB per
   worker` — binary + glue patch, no recompilation (see §6.1); measured
   separately as `after-wasm` since the 4 media workers instantiate at app
   start.
7. `[Perf] RLottie: Rebuild rlottie-wasm from source with SIMD and a 4 MB
   heap floor` — replaces the commit-6 binary patch at the source level
   (recipe + wrapper in `src/lib/rlottie/BUILD.md`); bit-exact against the
   old binary, +9–28 % render throughput, floor 6 → 4 MB per worker.
8. `[Dev] Perf: Add CPU profiler for the mocked scenario`
9. `[Size] RLottie: Shrink the rebuilt WASM with LTO, emmalloc and an -Oz +
   wasm-opt pass` — shipped module 134.7 KB brotli vs 131.6 KB for the old
   binary (§6.7).

Baseline → **after all six commits** (decimal MB, double-GC'd, DPR 2):

| Metric (MB) | S0 | S1 | S2 | S2m | S3 | S4 |
|---|---|---|---|---|---|---|
| JS heap | 20.9 → **20.9** | 30.4 → **30.6** | 31.1 → **31.6** | 32.3 → **38.4** | 41.6 → **47.8** | 41.1 → **41.6** |
| RLottie frame cache | 0.0 → **0.0** | 0.0 → **0.0** | 26.0 → **4.9** | 0.0 → **0.0** | 0.0 → **0.0** | **285.6 → 9.4** |
| — cached frames (count) | 0 → 0 | 0 → 0 | 303 → 10 | 0 → 0 | 0 → 0 | 678 → 279 |
| Live blob bytes | 0.0 → **0.0** | 1.7 → **1.7** | 1.7 → **1.7** | 27.8 → **29.4** | 27.8 → **32.1** | 27.8 → **32.1** |
| Canvas backing | 0.0 → 0.0 | 10.4 → 10.4 | 15.2 → 15.2 | 10.4 → 22.1 | 10.4 → 22.0 | 12.5 → 15.2 |
| Worker WASM heaps | **67.1 → 25.2** | 67.1 → 35.4 | 67.1 → 37.2 | 67.1 → 37.2 | 67.1 → 37.2 | **67.1 → 37.2** |
| Renderer PSS | 237.9 → **192.6** | 360.4 → **301.4** | 457.7 → **369.8** | 828.9 → **787.1** | 860.2 → **868.3** | **1200.6 → 930.6** |
| Total tree PSS | 568.0 → **440.8** | 703.8 → **564.6** | 826.1 → **659.7** | 1210.1 → **1085.9** | 1248.7 → **1186.9** | **1580.6 → 1239.1** |

Reading the table honestly:

- **The dominant defect is gone.** Steady state (S4, back in the sticker
  channel): decoded-frame cache 285.6 → 9.4 MB (−97 %); the surviving 279
  frames are small custom-emoji loops that legitimately fit both budget
  knobs. Renderer PSS −270 MB (−22.5 %), process tree −341 MB (−21.6 %).
  During the active sticker scroll (S2) the cache holds 4.9 MB vs 26.0 MB
  while animations keep playing.
- **WASM floor**: 67.1 → 25.2 MB at boot (4 × 6.29 MB). Under sticker load
  two workers grow to their real working set (total 37.2 MB) and — by wasm32
  design — never shrink; growth confirms the patched module renders
  correctly.
- **The media LRU never hit its budget in this scenario** (peak 32.1 MB of
  64 MB): the commit converts unbounded session-lifetime growth into a hard
  cap rather than shrinking this particular run; the small blob/heap/canvas
  increases at S2m/S3 are scenario noise (the after run paged slightly
  deeper: 61 vs 58 photos) plus LRU bookkeeping.
- **What remains in renderer PSS at S4 (930 MB) is mostly not the app's.**
  App-visible allocations sum to ≈ 95 MB (heap 41.6 + frames 9.4 + blobs
  32.1 + canvas 15.2); the rest is Chromium-managed discardable memory —
  chiefly the decoded-image cache from the 200-photo scroll and allocator
  retention — which evicts under memory pressure or navigation, not during
  a comfortable idle. Direct evidence: when an HMR reload recreated exactly
  this end state during the first `after` run, the same renderer settled at
  **207 MB**.

Re-measured with the source rebuild (commits 7–9, `after-simd.json`):

| Metric (S4 unless noted) | after (six commits) | after-simd (final) |
|---|---|---|
| RLottie frame cache | 9.4 MB / 279 frames | **8.9 MB / 279 frames** |
| Worker WASM heaps at boot | 25.2 MB | **16.0 MB** (4 × 4 MB) |
| Worker WASM heaps under load | 37.2 MB | **23.4 MB** |
| Renderer PSS | 930.6 MB | **803.1 MB** |
| Total tree PSS | 1239.1 MB | **1091.5 MB** |

Against baseline the final S4 numbers are: frame cache **−97 %**, renderer
PSS **−33 %**, process tree **−31 %**, and frames stay live where they
should (S2 sticker scroll: 10 frames / 4.7 MB cached while animating).
Run-to-run variance on the Chromium-discardable component of PSS is real
(±tens of MB); the wasm-heap and frame-cache columns are exact counters.

Both knobs are compile-time constants and act as feature flags:
`MAX_LOOP_CACHE_BYTES` / `FRAME_CACHE_GLOBAL_BUDGET_BYTES` (`RLottie.ts`) set
to `Infinity` and `MEDIA_MEMORY_CACHE_MAX_BYTES` (`config.ts`) set to `0`
restore the previous behavior exactly.

## 6. Deeper: WASM internals, the full library inventory, and the hardware floor

### 6.1 rlottie-wasm anatomy (and two patches without a compiler)

The vendored binary is 310 KB: 282 KB code, 24 KB data, no SIMD (the code
section contains no meaningful density of `0xFD`-prefixed vector opcodes —
rlottie rasterizes scalar). Its linear memory is **imported** from the JS
glue (`a.memory`): declared minimum 256 pages (16 MB), maximum 32 768 pages
(2 GB), growth enabled via `emscripten_resize_heap`. The emscripten layout
puts `DYNAMIC_BASE` at 5 275 232 — a 5 MB stack plus 24 KB of static data —
so of the 16 MB committed per worker, ~11 MB was pure headroom that malloc
had never touched, ×4 workers.

Two facts make this patchable without recompiling:

1. The glue reads `Module["INITIAL_MEMORY"] || 16777216` and separately
   clamps growth to `minHeapSize = 16777216` inside `emscripten_resize_heap`
   — both plain constants in `rlottie-wasm.js`.
2. The binary's memory-import minimum is a LEB128 integer. 256 encodes as
   `0x80 0x02`; 96 pages (6 MB) encodes canonically as one byte, but LEB128
   permits zero-padded encodings, so `0xE0 0x00` expresses 96 in the same
   two bytes — **no section offset in the file shifts**. Commit 6 applies
   exactly this byte pair.

Why this matters more than it looks: **wasm32 memory can never shrink** —
`memory.grow` is the only operation. Any transient peak (like the JSON leak
fixed in commit 3: 50–200 KB per animation load, forever) permanently
ratchets the worker's heap. Lowering the floor and eliminating leak-driven
growth are the only two levers that exist; both are now applied. A
`memory.discard`-style proposal exists upstream in the WASM CG but has not
shipped in any browser.

**Superseded:** commit 7 rebuilds the module from source (recipe and
wrapper in `src/lib/rlottie/BUILD.md`), making this binary patch
historical — the floor is now 4 MB per worker straight from
`-sINITIAL_MEMORY`, the glue is 16 KB, and the blend kernels plus the
ARGB→RGBA conversion run as WASM SIMD.

### 6.2 Full worker / library inventory

| Subsystem | Memory shape | Verdict |
|---|---|---|
| 4 × media workers (`launchMediaWorkers`, hosting `rlottie.worker` + `offscreen-canvas.worker`) | 16 MB → **4 MB** WASM floor each (commit 7) + worker JS runtime | **Now spawned individually on first use** — the login screen runs one media worker (the QR plane animation) instead of four; the rest join on demand as instances round-robin across indices |
| GramJS worker (`src/api/gramjs`) | `localDb` grow-only Records of TL class instances (H6); sender/auth maps bounded per-DC (≤ 5) | Out of scope (MTProto semantics); upstream LRU proposal in §4 rank 6 |
| fastText (`src/lib/fasttextweb`) | 1.1 MB wasm (937 KB embedded language model), memory **defined in-binary, fixed min = max = 16 MB** — not growable, not glue-patchable without relocating data segments | Only spawns when the native `LanguageDetector` API is missing (i.e. not in Chromium); **now lazily initialized on first `detectLanguage`** — the 17 MB heap + 1.1 MB fetch are paid only when detection is actually used |
| opus (`oggToWav`, Safari-only) | 2 workers per conversion, terminated after use | Clean |
| lovelyChart, media editor, blur hooks (`useCanvasBlur`, `getCustomAppendixBg`) | Transient canvases, bounded by UI | Clean |
| Teact/DOM | Falsified as a leak source (H4/H7): listeners and nodes track the 120-message window exactly | Clean |

### 6.3 The hardware floor (what "impossible" looks like)

Per-frame cost of one 208 px sticker at DPR 2: 416 × 416 × 4 = **692 KB**.
The baseline pipeline moved it four times: rlottie's rasterizer writes the
WASM buffer → copy into a persistent `ImageData` → `createImageBitmap`
snapshot → GPU upload at `drawImage`. Commit 5 deletes the middle copy; the
remaining three are irreducible *in this architecture* (write, snapshot,
upload).

A viewport of 20 animating stickers at 60 fps therefore moves
20 × 60 × 692 KB ≈ **830 MB/s** per remaining copy stage — ~2–5 % of a
DDR5 laptop's practical bandwidth. Memory bandwidth is **not** the binding
constraint; the binding constraints are (a) rlottie's scalar rasterizer
(CPU cycles — the reason the frame *cache* existed at all) and (b) resident
bytes, which is what this audit bounds.

The theoretical minimum for "what must exist somewhere" in this scenario:

- one premultiplied surface per *visible* animated element (~692 KB × N
  visible; ~10–15 MB for a dense viewport) — pixels you can see must live
  somewhere, by definition;
- compositor/framebuffer surfaces: 1440 × 900 × DPR 2² × 4 ≈ 21 MB × 2–3
  buffers (GPU process, not renderer);
- app JS + DOM + store: ~20–40 MB (dev server inflates this);
- one media worker grown to its working set (6–16 MB), idle ones at 6 MB.

That puts the physics-plus-Chromium floor for this scenario's renderer at
roughly **120–180 MB**. Against it: 1 200 MB at baseline S4; 930 MB
after all six commits *in-session* (of which only ≈ 95 MB is app-visible —
the rest is Chromium's discardable image cache from the photo scroll, see
§5); and **207 MB** for the identical end state after a reload, which is
the number the engineering in §6.4 moves toward the floor.

### 6.4 Roadmap to the floor (ranked; items marked ✅ have since landed)

1. **Render in the worker onto `OffscreenCanvas`**
   (`transferControlToOffscreen`): frames never become main-thread
   `ImageBitmap`s at all; the cache (and its eviction) lives next to the
   rasterizer; main-thread JS heap holds zero pixel data. Removes the
   snapshot copy — pipeline drops to write → upload, the architectural
   minimum. Large refactor: `RLottie`, `AnimatedSticker`, and the shared
   canvas custom-emoji path (multiple sprites per canvas) must move their
   draw loops worker-side.
2. ✅ **`ImageBitmapRenderingContext` for standalone stickers** — landed as
   `[Perf] RLottie: Hand frames to the compositor via bitmaprenderer
   canvases`: one view per animation transfers frames to the compositor (no
   2D backing store, no main-thread raster); consumed slots use a sentinel
   and re-render on the next loop pass; shared canvases and extra views keep
   `drawImage`. Verified visually and via frame counters (steady 273
   frames / 5.2 MB with a sticker viewport animating). The full-scenario
   re-measurement (`after-bitmap.json`) has clean S0/S1 checkpoints —
   boot renderer PSS 178 MB with zero media workers spawned — but its
   S2–S4 checkpoints were invalidated by dev-server HMR reloads from
   concurrent edits; re-run on a quiet tree (or against a production
   `build:mocked` once mocked scenarios are bundleable) before quoting
   steady-state numbers for this change.
3. **WebCodecs `VideoFrame` frames**: GPU-backed, explicitly closeable —
   decoded pixels move from renderer PSS to the GPU process and become
   evictable texture memory.
4. ✅ *(partially)* **Rebuild rlottie with SIMD** — landed as the from-source
   TG-fork rebuild (bit-exact, `-msse2 -msimd128` kernels + SIMD BGRA→RGBA
   conversion, +9–28 % measured). The remaining 2–4× requires vectorizing
   rlottie's scalar span/cell rasterizer itself (44 % of render time in the
   V8 tick profile) — upstream-scale work.
5. **Lazy media workers** (rank 7 in §4) and **lazy fastText init**: both
   done — fastText initializes on the first `detectLanguage` call
   (session 4), and media workers spawn per index on first use (§8), so
   boot pays for exactly as many workers as animations demand.
6. **Upstream**: `localDb` LRU (rank 6) and store slice eviction (rank 5).

### 6.5 Measured ceilings on this machine (`perf/limits.mjs`)

Every stage of the sticker pipeline, benchmarked in isolation (Intel Ultra 9
285H; the rasterizer numbers drive the *actual vendored WASM binary*
natively in Node; page numbers from headless Chromium — canvas output is
software raster there, so treat draw numbers as CPU-path ceilings):

| Stage | Measured ceiling | Note |
|---|---|---|
| DRAM copy (single thread) | **22.5 GB/s** node / 21.6 GB/s renderer | typed-array `set()` |
| rlottie render, complex sticker @ 416² | **650 → 705 fps** = 8.2 ns/px | SIMD rebuild, shipped -Oz build (commits 7/9) |
| rlottie render, simple icon @ 416² | 5 785 → **7 575 fps** = 0.76 ns/px | vector complexity, not pixels, dominates |
| rlottie render, complex @ 128² | 1 595 fps | per-frame setup cost dominates small sizes |
| `ImageData → createImageBitmap` @ 416² | 7 410 fps = 5.1 GB/s | the snapshot copy |
| `transferFromImageBitmap` (bitmaprenderer) | ~free (7 408 fps incl. snapshot) | supports roadmap #2 |
| full main-thread cycle (snapshot + draw + close) | **3 325 fps** = 2.3 GB/s | today's per-frame path |

What the numbers prove about "the absolute limit":

- A dense viewport (20 concurrent 208 px stickers × 60 fps = 1 200
  frames/s) consumes **3.8 %** of single-thread DRAM bandwidth — memory
  bandwidth is never the wall.
- 8.9 ns/px ≈ **45 CPU cycles per pixel**: the signature of scalar ARGB
  work through general-purpose registers. The `-msimd128 -msse2` rebuild
  (commit 7) was then measured, not predicted: **+9 % complex / +28 %
  simple** (705 / 7 575 fps) — not the naive 2–4×, because compiled SIMD
  only reaches the blend kernels and the wrapper's conversion, while ~40 %
  of ticks live in freetype-derived span-coverage accumulation
  (`gray_set_cell` 20.1 %, `gray_render_line` 10.0 %, `gray_raster_render`
  9.8 %) — a branchy scanline state machine no compiler auto-vectorizes.
  The 2–4× requires hand-vectorizing that kernel (§6.7).
- The rasterizer parallelizes across the 4 media workers today: ~2 600
  complex-frames/s fleet-wide ≈ **43 simultaneous worst-case stickers at
  60 fps at DPR 2** before any SIMD. Sticker *rendering* was never the
  bottleneck — resident frame bytes were, which is why caching (and this
  audit) is about memory, not speed.
- The narrowest stage is the **main-thread bitmap cycle: 3 325 fps**,
  single-threaded by construction. That dense viewport already spends 36 %
  of it. Roadmap #1 (OffscreenCanvas in workers) is what removes this wall:
  draw loops move next to the rasterizer, and the per-frame main-thread
  cost drops to zero. After that, on real GPUs the wall becomes texture
  upload — at which point roadmap #3 (WebCodecs GPU-backed frames) is the
  endgame; beyond it lies only the compositor itself.
- No hardware performance counters were readable in this environment (no
  `perf`, `perf_event_paranoid=2`), so cycles/px is inferred from
  throughput at nominal clocks rather than measured IPC.

### 6.6 The emcc-6 resizable-ArrayBuffer trap

emcc ≥ 6 defaults (`GROWABLE_ARRAYBUFFERS=1`) to backing the heap with a
resizable `ArrayBuffer` (`WebAssembly.Memory.toResizableBuffer()`) when the
engine has it. Chromium 148 does; Node 25 does not. `ImageData`'s WebIDL
does not opt into `[AllowResizable]`, so the zero-copy render path threw
`Failed to construct 'ImageData': The provided Uint8ClampedArray value must
not be resizable` on **every frame** in the browser — while every Node-side
check (bit-exactness, fps, `limits.mjs`) passed. Symptom: a full
measurement run with `RLottie frames: 0` at every checkpoint while wasm
heaps grew normally. Fix: `-sGROWABLE_ARRAYBUFFERS=0` (see `BUILD.md`).
Lesson: any wasm/glue upgrade needs an in-browser frame-delivery probe,
not just Node validation.

### 6.7 Where the CPU actually goes, and the real C++ ceiling

Main thread (V8 sampling profiler, `perf/profile.mjs`, 12 s of playback +
scroll): **82 % idle**, ~18 % V8 `(program)` (compositor/native). All Teact
internals combined — reconciliation, DOM ops, hooks — sum to ≈ 95 ms of
12 000 ms (**0.8 %**); the largest single app entry is `get scrollTop`
(72 ms of forced-layout reads in the infinite-scroll path). Rewriting the
framework buys nothing measurable at runtime; the CPU budget lives in the
render workers and the compositor.

Inside the wasm (V8 ticks over an instrumented build, `prof-report.txt`):
`gray_set_cell` 20.1 %, `lottie_render` self 17.8 % (≈ all of it the
ARGB→RGBA conversion — vectorized in commit 7), `gray_render_line` 10.0 %,
`gray_raster_render` 9.8 %, `blendColorARGB` 6.8 %, `SW_FT_*` fixed-point
trig/stroker ≈ 12 %.

The remaining C++-level ladder, ordered by measured leverage:

1. **Hand-vectorize span-coverage accumulation** (`gray_*`, ~40 % of
   ticks): a data-dependent scanline state machine — SIMD-able only with a
   redesigned cell layout (4–8 cells per lane, masked carry resolution).
   Realistic 2–3× on rasterization ⇒ ~1.8–2.5× overall; a fork-level
   rewrite of rlottie's freetype-derived raster, weeks of work, not flags.
2. **Replace the `SW_FT_Atan2` / `SW_FT_Vector_From_Polar` CORDIC loops**
   with polynomial approximations in the stroker (~12 % of ticks on
   stroke-heavy stickers) ⇒ +10–15 %.
3. **Threads** (`-pthread`, needs COOP/COEP headers): rlottie can tile
   `renderSync` internally (~3× on one large sticker), but the app already
   parallelizes across 4 workers — this only improves worst-case single
   stickers, not fleet throughput.
4. **Relaxed SIMD** (FMA/relaxed swizzle, shipped in Chromium) on
   gradient/blend paths: single-digit %.
5. Past CPU entirely: a WebGPU compute rasterizer for vector paths
   (vello-style) is the true hardware limit — order-of-magnitude on dense
   vector content, and a research-grade rewrite.

With steps 1–2 landed the complex-sticker ceiling moves from 705 toward
~1 500–2 000 fps/core (3–4 ns/px); across 4 workers that is 100+
worst-case stickers at 60 fps — past any real viewport, which is why the
architectural roadmap (§6.4) matters more than further rasterizer heroics.

## 7. Verification & regression safety

- `npx tsc --noEmit` and `eslint` clean on every commit.
- The measurement run itself exercises the core flows (chat switching,
  history scroll, sticker/custom-emoji playback, media viewer); the S4
  checkpoint validates stickers still animate (frame counters advance) and
  photos still render after LRU eviction (self-heal via `useMedia`).
- The patched WASM binary passes `WebAssembly.validate`, instantiates at 96
  pages in the full app, renders the whole scenario, and demonstrably grows
  under load (25.2 → 37.2 MB across the four workers) — i.e. the
  `emscripten_resize_heap` path is exercised, not just assumed.
- `perf/limits.mjs` drives the same binary natively in Node (real `.tgs`
  inputs from `src/assets/tgs`), which independently confirms
  `loadFromData` still parses after the commit-3 `_free` and the commit-6
  memory patch.
- The SIMD rebuild (commits 7/9) is validated three ways: bit-exact against
  the original binary in Node (max channel delta 0 across complex/gradient/
  static stickers), an in-browser probe asserting frame delivery in the
  sticker channel (`cachedFrames 279`) — the check that caught the
  resizable-buffer trap of §6.6 — and the full `after-simd` measurement
  run (frame cache live at S2/S4, wasm floor 16.0 MB at boot).
- No MTProto/API-layer behavior changed.

## 8. Boot speed (login-screen critical path)

Goal set in session 5: make first load visibly faster than `web.telegram.org/a`.
Milestone = first render of the auth-screen container (`probe-waterfall.mjs`),
fresh profile, headless system Chromium, CDP-throttled **10 Mbps / 40 ms RTT**,
served by `serve-dist.mjs` (in-memory brotli q9 — the same compression class the
production CDN uses). Medians of 5 runs.

| Serving | Cold auth screen | Warm reload | Wire bytes to auth |
|---|---|---|---|
| `master` @ `eb9f746` (the exact build `web.telegram.org/a` ships), localhost | 472 ms | 286 ms | 541 KB / 24 req |
| **This branch, localhost** | **449 ms** | **172 ms** | **255 KB / 12 req** |
| Live `web.telegram.org/a`, same throttle, real network (reference) | 914 ms | — | 664 KB |

Against the live site the branch is **2.0× faster cold** — but ~440 ms of the
live number is TLS + CDN + DC round-trips that any self-hosted deployment also
avoids, which is why the honest comparison row is master-on-localhost.

What put the branch ahead of master on identical serving (sessions 5–7):

1. **Wallpaper class only on the main screen** — took `pattern.svg` (496 KB raw,
   the single largest login-path asset) off the boot waterfall.
2. **colorjs.io out of the boot bundle** (`advancedColors.ts` split).
3. **Shared-UI chunk inlined into importers** + `modulepreload` for the
   runtime-loaded boot chunks (`fallback-*`, `qr-code-styling-*`), collapsing
   the serial discovery chain.
4. **Notification preview tree off the entry** — `util/notifications.tsx`
   imported `MessageSummary`, dragging `ActionMessageText` and friends
   (~55 KB source) into the entry for a feature that only runs when a push
   arrives; now a dynamic import. The notification sound `Audio` element is
   also created on first play instead of fetching `notification.mp3` at boot.
5. **Small `.tgs` no longer inlined** as base64 into chunks (entry carried
   ~30 KB of them).
6. **Per-index lazy media workers** — boot went from 5 workers (GramJS + the
   whole 4-worker media fleet, spawned because the QR plane is an animated
   sticker) to 2; each extra worker (+4 MB WASM heap) now spawns only when the
   instance round-robin actually reaches its index. Verified: mocked scenario
   still renders frames on all 4 workers under load (`cachedFrames 279`).

Result of 4+5: entry 539 → 480 KB raw (196 → 162 KB gzip); requests to auth
24 → 12; zero long tasks on the boot path in the final probe.

**Remaining levers, ranked** (the tail is now ~90 ms of exec+render after DCL,
not bytes):

1. *Auth-first entry split* — ~455 KB of entry source is the global store
   machinery (`reducers` 147 + `selectors` 114 + `helpers` 93 + `actions` 65 +
   `cache` 27 KB); the auth screen uses a sliver of it. Big, architectural,
   biggest single win left (~60–80 ms cold).
2. *Boot CPU profile* of the ~90 ms DCL→auth tail (sourcemapped) — nothing
   should be guessed here before profiling.
3. `deepLinkParser` (21 KB) and `@tauri-apps/api` (13 KB) still ride the web
   entry; both are gateable.
4. `fallback-*.js` (40 KB wire) is fetched on every boot before first paint —
   inline the most common strings or ship a slimmer auth-only pack.

## 9. Session F (parallel round): open latency, crypto, CSS, startup, media splits

Five orthogonal tracks run as isolated worktree agents (`perf/f-*`), merged on
`perf/f-integration`, coordinated with the other sessions via the claim board.
All numbers from the mocked scenario on a shared 16-core machine; ratios are
the signal, dev-server absolutes are inflated.

1. **Chat-open latency** (`perf/probe-open.mjs`, new): every chat open paid a
   second synchronous full-list reflow — the footer/composer bottom inset was
   written immediately before the scroll-restore clamp, dirtying layout
   (`get/set scrollTop` ≈ 1.1 s self-time per 10 opens at 4× throttle).
   `applyLastKnownBottomInset()` pre-applies the reserve in the mount layout
   effect, so the first (unavoidable) layout already includes it. Warm open
   245 → 145 ms (−41 %), long tasks per open 367 → 158 ms (−57 %) at 4×
   throttle; `probe-scroll-anchor.mjs` clean; mispredictions self-correct via
   the existing phase-4 write (perf fallback, not a correctness risk).
2. **WASM AES core** (`src/lib/gramjs/crypto/wasm/`): freestanding clang
   wasm32 AES-256 (no emscripten, fixed 2 MiB non-growable memory — the §6.6
   trap is impossible by construction) with IGE and CTR layers, wired into
   `IGE.ts`/`crypto.ts` behind an automatic, permanent JS fallback.
   Bit-exact vs `@cryptography/aes` and OpenSSL across sizes and odd CTR
   chunkings (`perf/bench-aes.mjs`); ~2.6–2.9× throughput (IGE dec ~105 →
   ~305 MB/s), i.e. per-MB worker crypto CPU ~19 → ~6.9 ms on every MTProto
   byte. Activates in `dist/` on the next build regeneration.
3. **CSS / media queries**: the only repeated-`matchMedia`-allocation
   patterns (media-viewer dimension helpers + per-mount listener) now share
   one cached MQL. Census of the built CSS: 258 `@media` blocks, no orphaned
   breakpoints, no `*`/`transition: all`, hover-during-scroll gating already
   present — no recalc fix survived scrutiny (documented in the session
   report; `prefers-reduced-motion` remains JS-driven, see
   `perf/reduced-motion-default`).
4. **Logged-in startup** (`perf/probe-coldstart.mjs`, new): falsified the
   persisted-cache suspicion (IDB read+parse 8–25 ms, `migrateCache` 0.3 ms);
   fixed mocked-mode cache discard so warm boots exercise the real hydration
   path (chat rows render synchronously from cache at ChatList mount); main
   bundle fetch now starts right after hydration instead of after the first
   render (+35 → −15 ms render→fetch gap). Warm nav→chat-rows 1620 →
   1077 ms (−34 %) on the corrected path. Top remaining lever: the ~260–330 ms
   "rows → detected" tail (rest of the Main mount tree).
5. **Media-feature lazy boundaries**: MediaEditor (65.7 + 10.5 KB) and the
   instant-view content tree now load on demand via the existing `Bundles`
   pattern; the eager chat chunk shrank by 86.3 KB raw / 24.1 KB gzip on
   every session, verified end-to-end headlessly (0 editor/IV modules fetched
   until used). Next candidate: MediaViewer/StoryViewer out of
   `Bundles.Extra` (981 KB raw downloaded on first photo click today).
