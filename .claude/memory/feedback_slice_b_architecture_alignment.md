---
name: Slice B architecture alignment
description: Agent home blocks live under packages/core/src/agent-home/ not as separate top-level domains. Don't duplicate dashboard view-model types in core. Mira excluded, not stubbed.
type: feedback
originSessionId: fd73d497-3bcd-4c57-83c1-3f6db9e99d88
---

Slice B blocks (greeting, wins, metrics, pipeline) live under `packages/core/src/agent-home/` — one folder, one module family, one mental model. Do NOT create separate top-level domain directories like `packages/core/src/greeting/`.

**Why:** The Slice B spec locked this organization intentionally. Each block is a projection in the same family, not an independent domain.

**How to apply:**

- New block projections go in `packages/core/src/agent-home/<block>.ts`
- Dashboard view-model types (`GreetingViewModel`, `ProseSegment`, `DataFreshness`) are locked in `apps/dashboard/src/lib/agent-home/types.ts` — core should define only internal projection types and map to the wire shape. Don't duplicate.
- Mira is excluded, not stubbed — reject before projection, don't add runnable config that throws.
- Always verify API route paths match existing patterns (e.g., decisions SDK/proxy pattern).
