# Telegram Web A

This project won the first prize 🥇 at [Telegram Lightweight Client Contest](https://contest.com/javascript-web-3) and now is an official Telegram client available to anyone at [web.telegram.org/a](https://web.telegram.org/a).

According to the original contest rules, it has nearly zero dependencies and is fully based on its own [Teact](https://github.com/Ajaxy/teact) framework (which re-implements React paradigm). It also uses a custom version of [GramJS](https://github.com/gram-js/gramjs) as an MTProto implementation.

The project incorporates lots of technologically advanced features, modern Web APIs and techniques: WebSockets, Web Workers and WebAssembly, multi-level caching and PWA, voice recording and media streaming, cryptography and raw binary data operations, optimistic and progressive interfaces, complicated CSS/Canvas/SVG animations, reactive data streams, and so much more.

Feel free to explore, provide feedback and contribute.

---

# Performance & Memory Optimizations

This fork carries an extended performance campaign on top of upstream (`master @ eb9f746`).
The work falls into two eras:

- **Media / RAM era** (documented in `MEMORY_AUDIT.md`): the dominant memory defects,
  almost all of them in decoded animation frames and media blobs. Headline numbers
  (mocked sticker+photo channel, headless Chromium, DPR 2, dev server): RLottie decoded-frame
  cache **285.6 → 8.9 MB (−97%)**, worker WASM heaps **67.1 → 16.0 MB (−76%)**, renderer PSS
  **1200.6 → 803.1 MB (−33%)**, whole process tree **1580.6 → 1091.5 MB (−31%)**, media blobs
  bounded by a 64 MB LRU, rlottie-wasm rebuilt from source with SIMD (**+9–28%** render throughput).
- **General (non-media) era** — the changes below. These target the four axes the media work
  left largely untouched: **cold start, warm/hot reload, non-media RAM, and general
  lightweightness**. Every item lists the exact file(s) and mechanism.

> Provenance: several parallel branches explored these axes. This branch (`perf/b-integration`)
> contains the changes marked **[B]**, each individually reviewed, type-checked, and — where
> noted — runtime-verified in the mocked app. Companion branches `perf/a-integration`,
> `perf/f-integration` and `perf/default-integration` carry the changes marked **[A]**, **[F]**,
> **[D]**; they are pushed alongside for review.

## 1. Cold start (fresh profile → auth screen)

- **[B] Defer the fallback language pack off the cold critical path** —
  `src/util/localization/index.ts`, `vite.config.ts`.
  The 40 KB `fallback-*.js` string pack was fetched (and `modulepreload`ed) before first paint.
  On a fresh profile the inlined `initialStrings` already cover every auth-screen key (verified:
  all 23 `lang()` keys used under `src/components/auth` are present), so the pack is now dropped
  from `CRITICAL_RUNTIME_CHUNK_RE` and fetched on `onIdle` instead — first paint is no longer
  gated on it, with no untranslated-key flash.
- **[A] Parse the fallback langpack at build time** and **[A/D] skip the deferred pack when
  `initialStrings` covers a key** — `src/util/localization`, build step. Complementary take:
  the fallback strings are pre-parsed at build time and the runtime fetch is skipped entirely
  when the inlined set already answers a lookup.
- **[A] Build heavy `Intl` formatters lazily** off the login critical path, plus a deterministic
  boot Intl-construction probe — `Intl.DateTimeFormat`/`NumberFormat` construction is expensive
  and was happening eagerly at boot.
- **[A] Move `selectCanAutoPlayMedia` off the entry-critical UI selectors** and **decouple chat
  selectors from the message-store tree** — trims the selector graph dragged into the boot chunk.
- **[A] `[Size]` Ship only the supported highlight.js grammars** for code highlighting instead of
  the full grammar set.
- **[D] Split boot-critical date formatters into a lean module** and **split pure currency
  converters off the JSX formatting tree** — keeps large formatting/JSX code out of the entry.
- **[D] Split payment-error helpers off the readable-error dictionary** — `getReadableErrorText`
  no longer drags the payment error tables into the boot path.
- Investigated and found **already optimized** (no change needed): `@tauri-apps/api` (kept out of
  the entry via an inlined `isTauri()` in `globalEnvironment.ts` and dynamic imports) and the
  deep-link parser (lives only in post-auth chunks).

## 2. Hot / warm reload (repeat visit, primed cache/SW)

- **[B] Cache the boot-blocking `redirect.js`, `compatTest.js` and `favicon.ico`** —
  `src/serviceWorker/assetCache.ts`, `src/serviceWorker/service.worker.ts`.
  These three unhashed root files matched neither the cache-first regex (needs a content hash)
  nor the network-first rule, so they hit the network on *every* warm reload. A new
  `respondWithStaleWhileRevalidate` responder serves them instantly from cache and refreshes in
  the background; they are precached on SW install. Result: **zero non-SW network requests on a
  warm reload**. (Inlining `redirect.js` into `index.html` was tried and rejected — the CSP
  `script-src 'self'` with no `unsafe-inline` blocks inline scripts.)
- **[D] Serve the app shell stale-while-revalidate** — companion SW change for the navigation
  document.
- **[F] Start the main bundle fetch right after hydration for logged-in sessions**, plus boot
  milestone instrumentation and a logged-in cold/warm boot timeline probe — returning users
  begin fetching `main` earlier instead of waiting on the full init cascade.
- **[F] `[Dev]` Keep the global cache for the mocked client** so warm boots hydrate from IndexedDB
  (makes the warm path measurable).

## 3. RAM — non-media retained memory

- **[B] Evict message slices for chats inactive in all tabs** —
  `src/global/reducers/messages.ts`, `src/global/intervals.ts`, `src/global/chatMessagesActivity.ts`,
  `src/config.ts`. The grow-only `messages.byChatId` store is now bounded: a module-level
  activity `Map` tracks when each chat's message list was last open, and a master-tab sweep
  reduces a chat's slice to the exact subset the cache serializer persists (last message +
  `lastViewportIds`) once it has been closed in every tab for `MESSAGE_STORE_EVICT_AFTER_MS`
  (10 min; `0` disables). Guarded by `canEvictChatMessages` (skips Saved Messages, forum/comment
  threads, drafts, edits, in-flight sends). The evicted shape is byte-identical to what the app
  rehydrates from IndexedDB on cold start, so reopening refetches through the known-good init
  path. **Runtime-verified** in the mocked app: 180 → 60 messages on eviction, 60 → 180 clean
  refetch-and-render on reopen (−66% per evicted chat / −33% whole store in serialized bytes;
  larger in live JS-heap terms). **[A/F/D]** carry a parallel implementation
  (`Evict grow-only message history of closed chats`, `f33908fbe`).
- **[B] Keep a chat's messages alive while its media is in the viewer** —
  `src/global/intervals.ts`. Eviction `unload()`s the media hashes of removed messages, and the
  media viewer can outlive its chat's message list (opened from shared media). The viewer's
  `chatId` is now part of the open-chats guard so an on-screen photo/video can't have its blob
  revoked.
- **[B] Bound the `withCache` memoization helper with an LRU** — `src/util/withCache.ts`.
  This helper backs `getFirstLetters` (avatar/chat initials), the legacy date formatter's
  per-day string cache and the emoji-unify cache with a `Map` that was never capped. Swapped for
  the existing `LimitedMap` primitive, 300 entries per memoized function — values are
  deterministic, so bounding only stops unbounded growth.
- **[B] Bound the per-chat language-detection stats map** —
  `src/components/middle/message/hooks/useDetectChatLanguage.ts`. `CHAT_STATS` grew one entry per
  chat that ever rendered a translatable message; now wrapped in `LimitedMap` (50 chats).
- **[D] Bound the transcriptions cache** to its newest entries, plus a global-store
  size-attribution hook and probe.

## 4. General lightweightness (CPU, bundle, feature loading)

- **[B] Pause the force-update ticker loop while the tab is hidden** —
  `src/hooks/schedulers/useIntervalForceUpdate.ts`. The 60 s ticker that re-renders online-status
  text, last-seen and gift countdowns is purely cosmetic; it now skips ticks while the tab is
  backgrounded (via the existing `useBackgroundMode`/`getIsInBackground`) and fires one catch-up
  render on focus, so no unseen reconciliation happens every minute in the background.
- **[F] `[Size]` Load the media editor lazily** when editing starts, and **load the instant-view
  content tree lazily** — moves two heavy feature trees out of the always-loaded graph.
- **[F] Reuse a single cached `MediaQueryList`** in the media viewer and unexport the Audio
  screen-width queries — avoids repeated `matchMedia` allocations.
- **[F] Pre-apply the bottom inset on the message list on mount** to avoid a second full-list
  reflow on open.
- **[A] `[Perf] Right Column`: Lazy-load the boost and monetization statistics screens** — these
  panels are now behind their own chunks.

## 5. Crypto (GramJS)

- **[F] Freestanding WASM AES-256 core with IGE and CTR layers**, and **route IGE/CTR through the
  WASM AES core with an automatic JS fallback** — MTProto's symmetric crypto runs through a
  compiled AES core when available, falling back to the existing JS path otherwise.

## 6. Tooling / mock fixes (support the above)

- **[A/F/D] Mock client fixes**: stub a session so mocked push registration doesn't throw
  (`26142effa`); fix a boot crash from the outdated `GetDialogFilters` shape (`0968a76cb`).
- Numerous `[Dev] Perf` probes under `perf/`: boot waterfall, warm reload, CPU attribution,
  memory dump / heap snapshots, chat-open latency, global-store size attribution, and hardware
  ceilings (`perf/limits.mjs`). See `perf/README.md` and `MEMORY_AUDIT.md`.

## Honest scope note

Unlike the media era (one dominant ~280 MB defect), the non-media surface was already
well-engineered — lazy component boundaries, split heavy deps, inlined `isTauri()`, bounded
date/emoji caches. The changes above capture the genuine remaining wins (unbounded stores and
caches, cold/warm request elimination, background CPU) and are individually modest but compound
over long sessions. The largest untouched non-media retainer is the GramJS worker's `localDb`
entity cache; bounding it safely requires care around MTProto `accessHash`/`fileReference` reuse
and is left for a supervised change.

---

## Local setup

```sh
mv .env.example .env

npm i
```

Obtain API ID and API hash on [my.telegram.org](https://my.telegram.org) and populate the `.env` file.

## Dev mode

```sh
npm run dev
```

### Invoking API from console

Start your dev server and locate GramJS worker in the console context.

All constructors and functions available in global `GramJs` variable.

Run `npm run gramjs:tl full` to get access to all available Telegram methods.

Example usage:
``` javascript
await invoke(new GramJs.help.GetAppConfig())
```

### Dependencies
* [GramJS](https://github.com/gram-js/gramjs) ([MIT License](https://github.com/gram-js/gramjs/blob/master/LICENSE))
* [fflate](https://github.com/101arrowz/fflate) ([MIT License](https://github.com/101arrowz/fflate/blob/master/LICENSE))
* [cryptography](https://github.com/spalt08/cryptography) ([Apache License 2.0](https://github.com/spalt08/cryptography/blob/master/LICENSE))
* [emoji-data](https://github.com/iamcal/emoji-data) ([MIT License](https://github.com/iamcal/emoji-data/blob/master/LICENSE))
* [twemoji-parser](https://github.com/jdecked/twemoji-parser) ([MIT License](https://github.com/jdecked/twemoji-parser/blob/master/LICENSE.md))
* [rlottie](https://github.com/Samsung/rlottie) ([MIT License](https://github.com/Samsung/rlottie/blob/master/COPYING))
* [opus-recorder](https://github.com/chris-rudmin/opus-recorder) ([Various Licenses](https://github.com/chris-rudmin/opus-recorder/blob/master/LICENSE.md))
* [qr-code-styling](https://github.com/kozakdenys/qr-code-styling) ([MIT License](https://github.com/kozakdenys/qr-code-styling/blob/master/LICENSE))
* [music-metadata](https://github.com/Borewit/music-metadata) ([MIT License](https://github.com/Borewit/music-metadata/blob/master/LICENSE.txt))
* [lowlight](https://github.com/wooorm/lowlight) ([MIT License](https://github.com/wooorm/lowlight/blob/main/license))
* [idb-keyval](https://github.com/jakearchibald/idb-keyval) ([Apache License 2.0](https://github.com/jakearchibald/idb-keyval/blob/main/LICENCE))
* [fasttextweb](https://github.com/karmdesai/fastTextWeb)
* fastblur

## Bug reports and Suggestions
If you find an issue with this app, let Telegram know using the [Suggestions Platform](https://bugs.telegram.org/c/4002).
