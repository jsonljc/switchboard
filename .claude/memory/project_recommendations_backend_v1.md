---
name: Recommendations Backend v1
description: Recommendations routing rail + shadow auto-actions — SHIPPED PR #357. v1.5/v2/v3 deferred.
type: project
originSessionId: fd73d497-3bcd-4c57-83c1-3f6db9e99d88
---

Shipped 2026-05-03 as squash merge PR #357 (all 21 plan tasks complete).

**What it delivers:** Hardcoded "Balanced" routing rail, shadow auto-actions with 24h undo window, emit path from ad-optimizer audit runner. Reuses `PendingActionRecord` (no new table — added `surface` + `undoableUntil` columns).

**Key files:**

- Core: `packages/core/src/recommendations/` (router, emit, act, interfaces, types, in-memory-store)
- DB: `packages/db/src/recommendation-store.ts`
- API: `apps/api/src/routes/recommendations.ts`
- Dashboard hooks: `use-recommendations.ts`, `use-shadow-actions.ts`, `use-recommendation-action.ts`
- Ad-optimizer sink: `packages/ad-optimizer/src/recommendation-sink.ts`

**Unwired (waiting on Phase 3 / activity trail rewrite):**

- `<ShadowActionList>` component is tested but not placed in `<ConsoleView>` — one-line wiring when trail lands

**Deferred versions (no specs written):**

- v1.5: Org-level mode selector (Conservative / Balanced / Aggressive)
- v2: Real Meta/Google API executor behind `confirm` + migrate act.ts through PlatformIngress.submit()
- v3+: Per-agent operator-tunable thresholds (explicitly "not a goal")

**Legacy bridge debt:** act-side bypasses PlatformIngress — registered in DOCTRINE.md Legacy Bridge Registry, same migration path as approval-response.
