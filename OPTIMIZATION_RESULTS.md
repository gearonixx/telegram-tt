# Optimization results — `memory-optimizations`

Baseline = master `eb9f746`. Numbers from `MEMORY_AUDIT.md` / `perf/` harness
(mocked sticker+photo channel, headless Chromium, DPR 2, dev server).

## Raw numbers

| Metric | Before | After | Change |
|---|---:|---:|---:|
| RLottie frame cache (S4) | 285.6 MB | 8.9 MB | −97 % |
| Worker WASM heaps (boot) | 67.1 MB | 16.0 MB | −76 % |
| Worker WASM heaps (under load) | 67.1 MB | 23.4 MB | −65 % |
| Renderer PSS (S4) | 1200.6 MB | 803.1 MB | −33 % |
| Process tree PSS (S4) | 1580.6 MB | 1091.5 MB | −31 % |
| Media blob cache | unbounded | 64 MB LRU | bounded |
| Boot: cold auth screen | 472 ms | 449 ms | −5 % |
| Boot: warm reload | 286 ms | 172 ms | −40 % |
| Boot: wire bytes to auth | 541 KB | 255 KB | −53 % |
| Boot: requests to auth | 24 | 12 | −50 % |
| Entry bundle (gzip) | 196 KB | 162 KB | −17 % |
| rlottie render throughput | 1.0× | 1.09–1.28× | +9–28 % |

## What it actually means

| In numbers | In plain terms |
|---|---|
| Frame cache 285 → 9 MB | Open a sticker/emoji-heavy chat and the tab no longer balloons by ~280 MB and keep it. This is the "500 MB tab" bug. |
| Renderer −33 % / tree −31 % | The whole tab uses roughly a third less memory once you've browsed media — after scrolling, not while idle. |
| WASM heaps 67 → 16 MB | The app reserves ~50 MB less just to sit there at startup. |
| Media blobs now capped | Every photo/sticker you loaded used to stay in RAM forever until you closed the tab. Now old ones get dropped automatically. |
| Warm reload −40 %, wire −53 % | Second load and refresh are noticeably snappier; half the download to reach the login screen. |
| Same look on screen | Correct — nothing visual changed. These are all "same picture, less RAM / faster load" fixes, not features. |

## Why you might not see it

| Reason | Detail |
|---|---|
| Only helps media-heavy use | Idle text chat saves ~nothing; the win appears after scrolling stickers/photos. |
| Dev vs prod | All memory numbers are from the dev server, which is inflated vs a real build. |
| Task-manager RAM ≠ app RAM | At S4 only ~95 MB of 803 MB is the app; the rest is Chromium's discardable image cache (evicts under pressure). Same state after reload = 207 MB. |
| wasm heaps never shrink | A spike stays until reload; the fix lowers the floor, not a single peak. |

## Caveat

`perf/out/*.json` (the raw runs) are gitignored — numbers are transcribed from
the audit, not re-verifiable without re-running `perf/measure.mjs`. Frame-cache
and WASM columns are exact counters; PSS columns vary ±tens of MB run-to-run.
