# Riley v3 Slice 5: Phase-C Seam (designed-but-unwired)

**Date:** 2026-06-05
**Status:** Design approved for implementation (rides in the implementation PR, like slices 3-4c)
**Parent spec:** `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` (sections 2.3, 2.4, slice 5, risk 8)
**Parent roadmap:** `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md` (Slice 5)

## Goal

Design, without wiring, the two halves of the bridge a future Phase-C session flips on:

1. The **ActionContract execution extension**: reversibility / rollback / success-metric / guardrail
   fields for the first self-executable action class (`pause`).
2. The **pause submit-request mapper**: a pure builder from a pause recommendation to a
   `CanonicalSubmitRequest`, defining a new ad-mutation intent (not the Mira creative handoff) and
   reusing the governed path's conventions. A convention-parity test ties it to the live
   `recommendation-handoff-request.ts` builder so drift in the real builder breaks this test.

No execution path is enabled. Advisory-only stays advisory-only: zero new `PlatformIngress`
callers in `packages/ad-optimizer`, zero Meta writes, zero new mutating callers anywhere.

## Decision 1: mapper lives in `apps/api`, not `packages/ad-optimizer`

The roadmap sketched `packages/ad-optimizer/src/phase-c/opportunity-to-submit-request.ts`. That
placement is impossible without violating the dependency doctrine: the mapper returns
`CanonicalSubmitRequest`, which lives in `@switchboard/core/platform`, and ad-optimizer is Layer 2
(schemas only, core import forbidden). Three options were considered:

- **(A) `apps/api/src/services/workflows/riley-pause-submit-request.ts` (chosen).** Layer 5
  imports anything; the live handoff builder (`recommendation-handoff-request.ts`) already lives in
  this exact directory for this exact reason, and the parity test must import that builder anyway,
  which only a Layer-5 test can do. The Phase-C wiring session will wire from Riley's cron in
  `apps/api`, the same place the handoff wired from, so the seam sits where it will be consumed.
- **(B) ad-optimizer mapper over a locally duplicated structural copy of `CanonicalSubmitRequest`,
  with a cross-package assignability test in apps/api.** Honors the roadmap's file path but
  duplicates a core platform type, the exact "silent duplication" failure mode the parent spec
  warns about for `deriveOwnership`, and still splits the mapper from its parity test.
- **(C) Defer the whole slice into the Phase-C wiring session.** The roadmap itself flags this
  option. Rejected for now: the convention-parity test has standing value today (it pins the
  seeded-actor / idempotency-key / targetHint conventions against silent drift in the live
  builder), and the contract seam unblocks the deferred-arm sessions (4d/4e, slice-5 wiring) from
  re-deriving eligibility.

The ad-optimizer half of the seam (Decision 2) stays in `packages/ad-optimizer`, surface-agnostic,
with a pointer comment each way.

## Decision 2: execution extension is a sibling record, not new fields on `ACTION_CONTRACT`

`ACTION_CONTRACT` is live, read by the sink, evidence floors, reset classification, and the
arbitrator. Growing every one of its 14 rows with execution fields "consumed by nothing yet" makes
dead weight look load-bearing and invites the "fields stored is not enforced" trap. Instead,
`packages/ad-optimizer/src/action-contract.ts` gains:

```ts
/** PHASE-C (designed-but-unwired): execution-time contract for a self-executed action. */
export interface PhaseCExecutionContract {
  /** PLATFORM-STATE reversibility (can the platform state be cleanly restored?).
   * Not outcome reversibility: lost delivery, auction re-entry, and missed bookings
   * during the paused window are NOT reversed by the rollback. */
  reversibility: "full" | "partial" | "none";
  rollbackPlan: string; // human-readable inverse action
  successMetric: string; // what improving looks like post-action
  guardrailMetrics: string[]; // abort signals the executor must watch
}

export const PHASE_C_EXECUTION_SEAM: Partial<
  Record<AdRecommendationAction, PhaseCExecutionContract>
>;
```

populated for **`pause` only** (reversibility `"full"`, rollback = resume the campaign, with the
rollback text explicit that it reverses platform state, not lost delivery), plus the single
class-eligibility predicate the wiring session consumes:

```ts
/** CLASS eligibility ONLY (the "first self-owned reversible action class" gate,
 * parent spec slice 5): is this ACTION CLASS structurally safe to ever self-execute?
 * It deliberately does NOT check request- or execution-eligibility: approval policy,
 * org entitlement, evidence, attribution confidence, learning/stability windows,
 * shared-budget/CBO membership, or budget-absorption risk are all wiring-session
 * (GovernanceGate + executor) concerns. */
export function isPhaseCActionClassEligible(action: AdRecommendationAction): boolean;
// = seam entry exists && reversibility === "full"
//   && ACTION_CONTRACT[action].resetsLearning === "no" && isMutating(action)
```

`pause` is the only action that passes (reversible, `resetsLearning: "no"`, mutating). The
predicate, not scattered conditions, is what Phase-C flips on. No other action gets a fabricated
reversibility classification (YAGNI; each future class earns its entry when it earns execution).
The live `ACTION_CONTRACT` is untouched, and a test pins both facts (14 keys unchanged; the seam
is a distinct object, not a mutation of the live rows).

## Decision 3: the mapper, its intent, and its conventions

`buildRileyPauseSubmitRequest(input, deployment): CanonicalSubmitRequest | null` in
`apps/api/src/services/workflows/riley-pause-submit-request.ts`, mirroring the live builder
convention-for-convention:

| Convention        | Live handoff builder                                                                            | Pause mapper                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor             | seeded `{ id: "system", type: "system" }` verbatim                                              | identical                                                                                                                                                                                                                                                                                                                                                           |
| Trigger / surface | `"internal"` / `{ surface: "api" }`                                                             | identical                                                                                                                                                                                                                                                                                                                                                           |
| Deployment        | REQUIRED `{ deploymentId, skillSlug }` threaded into `targetHint` (resolver does not fall back) | identical, resolves _Riley's own_ deployment, never Mira's                                                                                                                                                                                                                                                                                                          |
| Idempotency key   | `handoff:riley:<recId>:<action>` (4 segments)                                                   | `mutate:riley:<recId>:pause` (same shape, distinct namespace). Both keys assume recommendation ids are globally unique, which holds: they are Prisma `cuid()` primary keys (`PendingActionRecord.id` / `RecommendationOutcome.id`), so the key needs no org segment                                                                                                 |
| Abstention        | returns `null` via `shouldAbstainFromHandoff`; caller must not submit                           | returns `null` below the destructive-family evidence floor or when `!isPhaseCActionClassEligible("pause")`; reuses existing ad-optimizer floor exports. The live builder's learning-lock leg only fires for `resetsLearning === "yes"` actions; eligibility already requires `"no"`, so that leg is structurally inert for pause and is not replicated as dead code |
| Intent            | `adoptimizer.recommendation.handoff`                                                            | `adoptimizer.campaign.pause`, exported as `UNWIRED_RILEY_PAUSE_INTENT` so the symbol itself screams not-live                                                                                                                                                                                                                                                        |

On the evidence floor: `meetsEvidenceFloor` is the package-wide, family-keyed floor policy
(`evidence-floor.ts`), not a Mira-handoff contract; `pause` carries an explicit
`evidenceFamily: "destructive"` in the live `ACTION_CONTRACT` (floor `{clicks: 50,
conversions: 5, days: 7}`, no implicit defaults anywhere). A test pins the family so a future
re-classification of pause is a visible break. The recommendation-time floor is the _minimum_;
the wiring session may raise the execution floor without touching this seam.

The intent constant carries the roadmap-mandated note:
`// PHASE-C: intent name + Riley deployment resolution + governance seeding unresolved`.
The intent is **not** registered, seeded, or routed anywhere. The PRIMARY safety invariant is
"the mapper has no live importer", proven by grep on both the module path and the intent string
itself (someone could duplicate the string without importing the mapper). As defense in depth,
the governance engine is EXPECTED to default-deny unknown intents (the new-skill-intent recipe
documents this), but this slice does not lean on that as a guarantee and adds no governance-layer
test for it. Seeding the org allow policy, the entitlement-gate pass, and the executor
registration are the wiring session's job per the new-skill-intent recipe. The wiring session
must also branch on `"approvalRequired" in response` at the call site (documented in the mapper's
doc comment; unrepresentable in a test until a caller exists).

## Testing

`apps/api/src/services/workflows/__tests__/riley-pause-submit-request.test.ts`:

1. **Shape tests:** mapped request for a pause fixture (actor verbatim, intent, trigger, key,
   targetHint threading, parameters carry recommendationId/campaignId/rationale/evidence).
2. **Abstention tests:** null below the destructive evidence floor; null when learning-locked.
3. **Convention-parity tests (the anti-rot mechanism):** build the live handoff request and the
   pause request from equivalent fixtures and assert, field against field, identical `actor`,
   `trigger`, `surface`, identical `targetHint` key-set, and identical idempotency-key _structure_
   (4 colon segments, segment 1 `riley`, segment 2 the recommendation id, segment 3 the action).
   A drift in the live builder's conventions breaks this test even though the mapper is unwired.

`packages/ad-optimizer/src/action-contract.test.ts` (extend existing):

4. Seam record contains exactly `{ pause }`; pause entry pins reversibility/rollback fields.
5. `isPhaseCActionClassEligible`: true for `pause` only; table-test every other action false.
6. The live contract is untouched: `ACTION_CONTRACT` still has exactly its 14 keys, and the seam
   entry is a distinct object from `ACTION_CONTRACT.pause` (sibling, not mutation).
7. `evidenceFamilyFor("pause") === "destructive"` pinned, so the mapper's floor cannot silently
   weaken via a future re-classification.

**Unwired proof (PR gate, not a unit test):** grep the diff for `PlatformIngress` in
`packages/ad-optimizer` (none), confirm the mapper module is imported only by its test, grep the
intent string `adoptimizer.campaign.pause` for stray duplicates outside the mapper and its test,
and run `pnpm test` / `pnpm typecheck` / `pnpm arch:check` / `pnpm format:check`. Existing evals
(12+10 golden, 6 arbitration) untouched and must pass unchanged.

## Out of scope (deliberately)

- Any caller of the mapper; any registration/seed/executor for `adoptimizer.campaign.pause`.
- Rollback/guardrail _execution machinery_ (the fields are declarations, strings, not code).
- Seam entries for any action other than `pause`.
- `deriveOwnership` consolidation (separate in-flight workstream) and the 4d/4e deferred arms.
- Migrations, env vars, routes, dashboard changes: none. ZERO schema-package changes.

## Risks

- **Long-lived unwired code rots.** Mitigated by the parity test (live-builder drift breaks it)
  and by `isPhaseCActionClassEligible` being consumed verbatim by the wiring session.
- **Semantic gravity: the seam looks like real execution plumbing.** Mitigated by naming
  (`UNWIRED_RILEY_PAUSE_INTENT`, `isPhaseCActionClassEligible`), by doc comments that state class
  eligibility is not execution eligibility, and by the intent-string grep in the PR gate.
- **Concurrent session overlap.** The deriveOwnership worktree touches `recommendation-sink.ts`,
  `audit-runner.ts`, `index.ts`, and `schemas/ad-optimizer.ts`. This slice touches none of those
  except possibly `packages/ad-optimizer/src/index.ts` exports; conflict surface is one export
  block, resolvable mechanically.
- **Placeholder intent ossifies.** The PHASE-C note marks it unresolved; the wiring session owns
  the final name and may rename freely since nothing persists or routes on it.
