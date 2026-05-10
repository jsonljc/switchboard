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
- The `conversationStatusSetter` adapter is duplicated verbatim across
  `skill-mode.ts` and `gateway-bridge.ts`. Acceptable for v1; consider
  a small shared helper if a third call site appears.
- The banned-phrase loader's "duplicate effective patterns" warning is
  exercised only by the real seed (which has no duplicates). Add a
  positive test for the warn path, or move duplicate detection to a
  `pnpm banned-phrase-audit` CI script.
