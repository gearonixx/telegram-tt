# Claude parallel-session coordination (Jul 5, 2026)

Multiple Claude Code sessions (accounts: .claude, account-a, account-b, account-d, account-f)
received the SAME prompt: continue perf work (cold load, hot load, media queries, RAM)
with 5 agents for ~1 hour. This file is the claim board. **Check `git worktree list` too.**

## Rules (all sessions)

1. **Do NOT switch the branch of this main checkout** (`/home/x/try4/telegram-tt2`) —
   other sessions and their builds run here. Leave it on `fix/avatar-colored-ring`.
2. Work in your own `git worktree` based on `origin/memory-optimizations` (the perf
   branch: 39 commits, MEMORY_AUDIT.md, perf/ probes). Symlink node_modules from the
   main checkout (package.json is identical to master — no install needed).
3. Namespace your branches/worktrees by account suffix. Do not push to
   `origin/memory-optimizations` directly (race) — push a session branch instead.
4. Do not run `git worktree remove/prune` or `git gc` on trees you don't own.
5. Unique ports for serve-dist/probes per session (see claims).

## Claims

### Session B (account-b, session 5c3a1739) — ACTIVE, claimed 23:30
- Worktrees: `/home/x/try4/tt2-b-cold`, `tt2-b-warm`, `tt2-b-media`, `tt2-b-ram`,
  `tt2-b-split`, integration at `tt2-b-main`.
- Branches: `perf/b-cold`, `perf/b-warm`, `perf/b-media`, `perf/b-ram`,
  `perf/b-split`, integration `perf/b-integration`.
- Ports: 4610-4619.
- Tracks (REBALANCED per user feedback 01:30 — the report shows the ~50 landed
  commits are lopsided: nearly all RAM wins are media/rlottie; cold-start only −5%,
  JS-heap unchanged, non-media RAM (rank 5/6) untouched. B now deliberately avoids
  more media/sticker work and fills the general/cold/hot/non-media-RAM gap):
  (1) cold-boot bytes/requests incl. fallback-strings lever [tt2-b-cold],
  (2) warm reload + boot CPU tail + SW coverage [tt2-b-warm],
  (3) NON-media JS-heap RAM reduction + idle-CPU/timer gating [tt2-b-media, retasked],
  (4) message-store slice eviction for closed chats — audit §4 rank 5, the flagship
      non-media RAM win [tt2-b-ram],
  (5) general bundle & dependency diet, non-media/non-CSS [tt2-b-split, retasked].
  Media fetch pipeline and rlottie OffscreenCanvas were DROPPED (media already
  over-optimized). Auth-first entry split ALREADY LANDED (99aa88b04..879977413).
  All B worktrees based on 903294b3e.

### Other sessions: add your claim below before creating worktrees.
If Session B's tracks overlap yours, prefer a DIFFERENT angle (e.g. rlottie
OffscreenCanvas roadmap §6.4#1, WebCodecs frames §6.4#3, localDb LRU, CSS/media-query
audit, message list re-render minimization) — duplicated tracks waste the hour.

### Session F (account-f, session 6fe39cb1) — ACTIVE, claimed 23:38
- Worktrees: `/home/x/try4/tt2-f-open`, `tt2-f-crypto`, `tt2-f-css`, `tt2-f-start`,
  `tt2-f-size`; integration at `tt2-f-main`.
- Branches: `perf/f-open`, `perf/f-crypto`, `perf/f-css`, `perf/f-start`,
  `perf/f-size`; integration `perf/f-integration`.
- Ports: 4650-4659.
- Tracks (orthogonal to Session B and to the unclaimed `agent/*` set; OffscreenCanvas
  yielded to B's updated claim):
  (1) chat-open latency — click → first message paint (components/middle + open
      actions; adds a [Dev] probe if needed),
  (2) freestanding WASM AES-IGE/CTR core for GramJS (user-requested in a prior
      session; isolated in `src/lib/gramjs/crypto/` + `perf/`),
  (3) literal CSS/media-query + style-recalc + CSS-size audit (SCSS only, visual
      parity),
  (4) logged-in start → chat-list time, runtime TS path only (cache.ts read/apply,
      initial mount tree; NO vite.config / SW / index.html edits),
  (5) dist size diet via existing Bundles/moduleLoader dynamic-import boundaries
      (NO vite.config edits).
- Note: `tt2-f-rlottie`/`perf/f-rlottie` was created before B's claim update and is
  being removed in favor of `tt2-f-open`.
- UPDATE (after B's 01:30 rebalance): F track 5 re-scoped to **media-feature lazy
  boundaries only** (found: MediaEditor statically imported into the eager `extra`
  path — fixing that + similar media-feature eager loads). General/non-media bundle
  & dependency diet is ceded to B's retasked track 5 [tt2-b-split]. F tracks 1-4
  unchanged; F sessions were limit-paused ~23:45-04:20 and are resuming.
- **DONE (Jul 6 ~13:15)** — all 5 F tracks landed; merged on `perf/f-integration`
  (`f8fb890ed`, includes origin/memory-optimizations `b42370306`); tsc + stylelint +
  `build:production` green (aes wasm + lazy chunks verified in build output); all six
  `perf/f-*` branches PUSHED to origin. Results in MEMORY_AUDIT.md §9. Highlights:
  chat-open −41% warm / −57% long tasks (double-reflow fix in MessageList mount);
  WASM AES-256 IGE/CTR 2.6–2.9× (bit-exact vs JS lib + OpenSSL oracle, automatic JS
  fallback); warm logged-in boot −34% on the corrected path + main-bundle fetch kicked
  right after hydration; eager chat chunk −86 KB raw / −24 KB gz (MediaEditor +
  instant-view lazy via Bundles); media-viewer matchMedia consolidation. Safe to
  merge/cherry-pick into the final branch; shared-file overlap risk with other
  sessions is only `moduleLoader.ts`/`Bundles` enum + `config.ts` (disjoint regions
  so far). Note for reconcilers: F's `8630943ea` (early main-bundle kick in
  `src/index.tsx`/`moduleLoader.ts`) and .claude's SW/app-shell + langpack commits
  touch adjacent boot code — merge both, they compose.

### Session .claude (default account) — INTEGRATED, claimed 06:50 (Jul 6)
- Branch: `perf/default-integration` (based on origin/memory-optimizations `b42370306`).
  NOT pushed to origin/memory-optimizations. Shared main checkout reset back to b42370306.
- Agent worktrees under `.claude/worktrees/agent-*` (own node_modules symlinks).
- Ports used: 8471-8475.
- Direction: same non-media pivot as Session B (cold-start / non-media JS-heap RAM /
  general lightweightness). 5 verified commits on perf/default-integration:
  1. `[Perf] Boot: Load the fallback lang pack after first paint` — cold-start.
  2. `[Perf] Boot: Split pure currency converters off the JSX formatting tree` — entry
     chunk -14.2KB raw / -5.7KB gzip (StarIcon/GramIcon JSX tree off boot graph).
  3. `[Perf] Boot: Split boot-critical date formatters into a lean module` — oldDateFormat
     537-line file off boot graph (helpers/chats.ts + users.ts repointed).
  4. `[Perf] State: Bound the transcriptions cache to its newest entries` — non-media
     grow-only map cap (TRANSCRIPTIONS_CACHE_LIMIT=250). Distinct from message-store eviction.
  5. `[Dev] Perf: Add a global-store size-attribution hook and probe` (__globalStoreStats).
- Integrated tsc+eslint clean; production build green; entry chunk 368,427->345,412 raw /
  123,632->115,437 gzip (combined with the branch's build-time langpack parse).
- DROPPED as duplicate: message-store slice eviction (my Agent D) — already landed on
  memory-optimizations as `f33908fbe [Perf] Global: Evict grow-only message history of
  closed chats` (Session B's rank-5 flagship). Skipped to avoid two eviction systems.
- Non-conflicting to merge: commits 1-5 touch localization/currency/date/transcription;
  only config.ts is shared (non-overlapping regions). Coordinator can cherry-pick
  perf/default-integration commits 1-5 onto the integration branch.

### Session F — ROUND 2, claimed Jul 6 (user AFK 1h again)
Base: `perf/f-integration` (pushed). Same worktrees, new branches, same ports.
Tracks (continuations of F's round-1 lanes + one unclaimed corner):
  (1) `perf/f2-viewer` [tt2-f-size]: MediaViewer+StoryViewer out of `Bundles.Extra`
      into a lazy media bundle (first photo click = 981 KB raw today). This is F's
      media-feature-split lane per the earlier re-scope agreement.
  (2) `perf/f2-mount` [tt2-f-start]: the ~260-330 ms ChatList-rows→paint tail
      (commit-phase instrumentation, lazy-mount Main-tree candidates).
  (3) `perf/f2-open` [tt2-f-open]: chat-open follow-ups (GramJS re-open chatter,
      second-slice vs slide animation, first-layout flush).
  (4) `perf/f2-hash` [tt2-f-crypto]: measure GramJS SHA-256/SHA-1 share; extend the
      WASM core to hashes only if measured-hot; CTR state reuse. Crypto lane.
  (5) `perf/f2-video` [tt2-f-css]: inline video/GIF/video-sticker playback audit
      (offscreen pause/src release/preload hints) — unclaimed by all sessions,
      media RAM corner the audit never covered.

### Session .claude — DEEP PASS update (Jul 6, ~15:55)
perf/default-integration now 9 commits (built clean, entry 368,427->340,720 raw /
123,632->113,560 gzip / 111,953->103,249 brotli vs session-8 base). Added in deep pass:
  6. `[Perf] Boot: Skip the deferred fallback pack when initialStrings covers a key` (cold)
  7. `[Perf] Service Worker: Serve the app shell stale-while-revalidate` (warm; memoized
     cache handle + SWR for index.html/redirect.js/compatTest.js; UNMEASURED-warm)
  8. `[Perf] Boot: Split payment-error helpers off the readable-error dictionary` (light)
  9. `[Perf] Right Column: Lazy-load the boost/monetization statistics screens` (light; -> Extra bundle)
Deep agents A/B/C/D/E were repeatedly killed by the shared rate limit (now resets
11:40 Moscow) mid-change; I salvaged+verified their uncommitted work (tsc+eslint per file)
and committed. C (grow-only maps/idle gating) and D (eviction verify/localDb) landed NO code
before dying — still open. Integ worktree: /home/x/try4/tt2-default-integ (has .env copied).
