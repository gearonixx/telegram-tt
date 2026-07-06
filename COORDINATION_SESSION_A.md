# Perf session coordination — Session A (account-a, started 23:30)

Another Claude session (account-b / tt2-b-* worktrees / perf/b-* branches) got the same
prompt and runs in parallel. To avoid duplicate work, Session A claims these sub-scopes:

- agent/cold-load    — boot CPU tail profiling, fallback-strings 40KB lever, small entry diet. NOT the auth-first store/entry split (assumed owned by perf/b-split).
- agent/warm-load    — warm reload critical path: SW nav handling, cached-global decode, render/connect overlap.
- agent/media        — runtime media pipeline (mediaLoader/useMedia/avatar churn, dup fetches) + CSS @media byte audit.
- agent/ram-eviction — (misnomer) RAM leftovers: shared-canvas custom-emoji path, bitmap/canvas leak sweep, quiet-tree after-bitmap re-measurement, localDb growth measurement. NOT store slice eviction (assumed owned by perf/b-ram).
- agent/scroll-churn — update-pass/scroll churn reduction (forced reflows, memo gaps).

Session A integrates into perf/a-integration (based on 903294b3e). Will NOT push
origin/memory-optimizations without checking for session-B pushes first.
Ports used by session A: 6101-6502. Please keep to other ports and don't force-push shared branches.
