# Alex SG/MY Medspa — Phase 1b-1.5 Regulatory Review Handoff

**Date:** 2026-05-10
**Status:** Open — pending regulatory reviewer assignment
**Depends on:** Phase 1b-1 merged

## Purpose

Phase 1b-1 ships the deterministic safety gate with **conservative seed
tables** (≥5 entries per category, real but not exhaustive). This
follow-up phase expands the tables with input from a named regulatory
reviewer (or consultant) for SG and MY medspa contexts.

## Scope

Expand:

- `packages/core/src/governance/banned-phrases/sg.ts` — HSA, SMC, HCSA,
  MOH must-not-say language for medical aesthetic clinics
- `packages/core/src/governance/banned-phrases/my.ts` — MAB, MMC, KKM,
  APC/LCP must-not-say language
- `packages/core/src/governance/escalation-triggers/sg.ts` — SG-specific
  inbound sensitivity (e.g., reference to specific HSA-flagged devices)
- `packages/core/src/governance/escalation-triggers/my.ts` — MY-specific
  inbound sensitivity

For each new entry:

- Add a stable `id`
- Choose the right `category`
- Add `notes` citing the regulatory source (e.g., HSA Notice 2024/X)
- Add to the relevant test fixture (the loader's true-positive set)

## Out of scope for 1b-1.5

- Schema or interface changes (the 1b-1 contract is locked)
- Multi-tenant per-clinic customization (that's 1b-2 or later)

## Open question

Who owns this review? Until a named reviewer is assigned, the seed
tables remain in production with conservative behavior — false
positives possible, false negatives covered by the seed plus operator
escalation as a backstop.

## Known follow-ups from 1b-1 review

- The startup assertions in `apps/api/src/bootstrap/skill-mode.ts` and
  `apps/chat/src/gateway/gateway-bridge.ts` checking governance dep
  presence are effectively dead code today (all checked values are
  locally constructed consts that cannot be falsy). They were intended
  as future-proofing for a refactor that injects deps from outside the
  bootstrap function. Either remove them or convert to typed assertions
  on the inputs to `new ChannelGateway(...)` / `new
DeterministicSafetyGateHook(...)`.
- The `conversationStatusSetter` adapter implementations differ between
  `skill-mode.ts` (update-only — row exists by the time skill execution
  runs) and `gateway-bridge.ts` (upsert when context is available, for
  first-message sessions). The split is load-bearing; do not collapse
  them into one shared helper without verifying the invariant still
  holds for both call sites.
- The banned-phrase loader's "duplicate effective patterns" warning is
  exercised only by the real seed (which has no duplicates). Add a
  positive test for the warn path, or move duplicate detection to a
  `pnpm banned-phrase-audit` CI script.
- `GovernancePostureCache` is constructed independently in `apps/api`
  (skill-mode.ts) and `apps/chat` (gateway-bridge.ts) — these are
  separate processes in production, so warm hits do NOT propagate
  cross-process. The spec's "shared cache" wording is misleading; it
  applies in single-process dev only. Each process fails closed
  independently after its own first successful resolution. Promoting
  to a Redis-backed cache (or a separate cheap "is-governed" flag on
  AgentDeployment that the resolver consults independently) is the
  upgrade path captured in spec Open Question 1.
- The sticky `human_override` guard in `PrismaConversationStore.save()`
  (Step 4 of the 1b-1 follow-up hardening) does a `findUnique` before
  each `upsert`. This is a small extra query per save. If profiling
  shows it's a hot path, consider promoting `human_override` to a
  dedicated `is_overridden: boolean` column with a schema migration —
  that would let the guard be expressed as a conditional column write
  without a separate read.
