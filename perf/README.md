# Memory measurement harness

Reproducible memory profiling for the S0–S4 scenario described in
`MEMORY_AUDIT.md`. Drives a Chromium instance over the app and records, at
every checkpoint: GC'd JS heap, DOM node / listener counts, live object-URL
count and bytes, RLottie frame-cache stats, media memory-cache stats, GramJS
worker `localDb` sizes, media-worker WASM heap sizes and per-process RSS/PSS
(Linux). The in-page counters come from `DEBUG`-only hooks
(`window.__rlottieStats`, `window.__mediaCacheStats`, worker
`__rlottieWasmStats`) plus an `URL.createObjectURL` wrapper injected by the
harness itself.

## Scenario

| Checkpoint | State |
|---|---|
| S0 | cold load, idle |
| S1 | 5 media-heavy chats opened sequentially |
| S2 | ~300 messages scrolled back in a sticker-heavy chat |
| S2m | ~140 messages scrolled back in a photo-heavy chat (mocked mode) |
| S3 | media viewer opened/closed 10× |
| S4 | back to the first chat, long idle |

## Mocked mode (no account needed)

Uses the `perf` mock scenario (`src/lib/gramjs/client/__mocks__/perf.json` +
`__invokeMiddlewares__/perf.ts`): a sticker/custom-emoji channel with 600
messages and a photo channel with 240 × ~540 KB photos. The photo payload
(`__data__/perf-photo.png`) is generated on first run by `gen-photo.mjs` and
is not committed — running `#mockScenario=perf` manually without it silently
falls back to the default scenario.

```bash
npm run dev:mocked        # in one terminal
node perf/measure.mjs --label baseline
node perf/measure.mjs --label after-fix
node perf/measure.mjs --compare perf/out/baseline.json perf/out/after-fix.json
```

## Real mode

```bash
# One-time login (opens a headed window, log in, wait for the chat list):
node perf/measure.mjs --mode real --url https://web.telegram.org/a/ \
  --profile ~/.tt-perf-profile --login

# Measure:
node perf/measure.mjs --mode real --url http://localhost:4173/ \
  --profile ~/.tt-perf-profile --chats "Chat One,Chat Two" --label after-fix
```

## Options

- `--dpr N` — deviceScaleFactor (default 2; decoded sticker frames and photos
  scale by dpr², which is the regime where real-world tabs reach 500 MB+).
- `--idle-s0` / `--idle-s4` — idle seconds at S0/S4.
- `--scroll-messages` / `--scroll-media` — scrollback depth for S2/S2m.
- `--viewer-cycles` — media viewer open/close count for S3.
- `--snapshots` — take a heap snapshot at S4 and report detached-node count.
- `--headed` — run with a visible browser window.
- `--executable <path>` — Chromium binary (defaults to the system one, or set
  `PERF_CHROME`).

Results land in `perf/out/<label>.json` and are printed as a table. Numbers
from the dev server are consistent between runs but higher than a production
build; compare like with like.

## Hardware ceilings

`node perf/limits.mjs [--page]` benchmarks each pipeline stage in isolation:
DRAM copy bandwidth, the vendored rlottie WASM rasterizer driven natively in
Node against real `.tgs` inputs, and (with `--page`) the renderer-side
`createImageBitmap` / `drawImage` / `bitmaprenderer` ceilings in headless
Chromium. Results go to `perf/out/limits.json`; interpretation lives in
`MEMORY_AUDIT.md` §6.5.

## Boot speed

`node perf/serve-dist.mjs [dir] [port]` serves a build with in-memory brotli
(q9). Always measure against this rather than an uncompressed static server —
uncompressed serving inflates wire size ~2.5× and skews comparisons.

`node perf/probe-waterfall.mjs <url> [--throttle] [--runs N] [--mbps N] [--rtt N]`
loads the app in a fresh profile, waits for the auth screen, and prints the
request waterfall, long tasks and per-run milestones. `--throttle` applies
10 Mbps / 40 ms RTT via CDP so localhost and deployed origins compare fairly.

`node perf/probe-warm.mjs <url> [runs]` measures a cached reload in the same
context (the repeat-visit path).

Results and the remaining lever list live in `MEMORY_AUDIT.md` §8.
