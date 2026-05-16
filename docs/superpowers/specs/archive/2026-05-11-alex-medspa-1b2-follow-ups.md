# Phase 1b-2 — Follow-ups

**Date:** 2026-05-11
**Owner:** TBD (assign at PR review)

## 1. `ApprovedComplianceClaim` seed authorship

The 1b-2 PR ships the store and substantiation resolver but no rows. Pilot
tenant needs an initial set of approved compliance claims for the top
efficacy / safety / superiority statements Alex is observed making during the
1b-2 observe-mode rollout.

- Target tenant: TBD
- Expected first 10 claims: TBD
- Reviewer name + role (stamped into `reviewedBy`): TBD
- Authoring path: `packages/db/prisma/seed-approved-compliance-claims.ts`
  or one-off admin script.

## 2. Phase 1b-2.5 regulatory-source expansion

The 1b-2 seed tables in `packages/core/src/governance/classifier/regulatory-sources/{sg,my}.ts`
are conservative floor coverage (≥3 per category per jurisdiction). A
regulatory consultant should expand to exhaustive coverage of:

- HSA / MDA approved devices (target: ≥20 each jurisdiction)
- Doctor credential paths (named entries for pilot-tenant doctors)
- ISO / GMP / public certifications used in marketing copy

## 3. Cache invalidation on `ApprovedComplianceClaim` upsert

1b-2 ships match-only LRU caching. New approved claims that supersede an
existing match would require invalidation. v1 workaround: process restart
or admin endpoint. Phase 3 should ship event-driven invalidation.

## 4. Confidence threshold tuning

The classifier returns `confidence` but 1b-2 does not gate on it. A future
tuning step could escalate (rather than rewrite) when `confidence < 0.5`.
Eval-harness data informs the threshold.

## 5. Per-claim-type mode override

The `governanceConfig.claimClassifier.mode` is flat in 1b-2. A future
ergonomic could allow per-claim-type promotion (e.g., enforce on urgency
while still observing on efficacy).

## 6. Cross-message service-context tracking

`ApprovedComplianceClaim` has no `serviceId` column in 1b-2 — codebase has
no relational `Service` Prisma model yet. When a future phase ships
`Service`, `serviceId String?` becomes a clean additive migration and the
resolver gains the precedence rule (service-scoped beats global).

## 7. Persistent `GovernancePostureCache`

Per-process / per-instance cache works for the v1 pilot envelope. At scale,
either a Redis-backed cache or a separate "is governed?" flag column on
`AgentDeployment` becomes the right primitive. Same upgrade path 1b-1 noted.

## 8. Tighten hook-ordering test (Task 16 review note)

The hook-ordering test in `apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts`
asserts `classifierIdx > deterministicIdx` (weaker: "after") rather than
`classifierIdx === deterministicIdx + 1` (stronger: "immediately after").
Tighten to the stronger form so a future hook insertion between them is
caught by the test.

## 9. Optional: expand classifier hook test coverage

The Task 15 spec review noted these uncovered branches in `claim-classifier.test.ts`:

- `classifier_timeout` (timeout outcome from runClassifier)
- `testimonial` and `medical-advice` claim types (currently only `diagnosis` covers ESCALATE_ONLY)
- `credentials` stale and missing branches
- Observe mode + escalate-class outcome (currently only rewrite-class observe is tested)
- Multi-sentence response with mixed allow + escalate

All are test-coverage gaps, not implementation bugs.

## 10. Widen `GovernanceVerdictDetails` so 1b-2 doesn't need `as any`

The 1b-1 `GovernanceVerdictDetails` type in `packages/core/src/governance/governance-verdict-store/types.ts`
is narrowly typed to four fields (`matchCategory`, `matchId`, `matchedText`, `sentence`). 1b-2 writes
richer details (`promptVersion`, `promptHash`, `schemaVersion`, `model`, `claimType`, `confidence`,
`originalSentence`, `rewrittenSentence`, `matchedSourceId`, `matchedSourceType`, `errorKind`,
`latencyBudgetMs`, `errorMessage`), forcing four `as any` casts in `claim-classifier.ts` at the
`verdictStore.save(...)` call sites.

The JSON column persists the richer details fine (Prisma `Json?` accepts anything), so this is
purely a TypeScript narrowness issue, not a runtime bug. Fix: widen `GovernanceVerdictDetails`
to `Record<string, unknown> & { matchCategory?: string; matchId?: string; matchedText?: string;
sentence?: string }` (or split into 1b-1 and 1b-2 detail shapes with a discriminator).

Five-minute follow-up; removes the four `as any` casts and aligns the type with what's persisted.
