# 1B-2a scorer-gate — TDD plan (ephemeral scratch, uncommitted)

Slice (split out of 1B-2 per ORIENT): the outcome ledger scores ONLY executed Riley moves.
Add the `executedAt:{not:null}` scorer gate + make the OPERATOR acted-writer stamp executedAt
(else operator-acted recs silently stop scoring) + backfill historical operator-acted rows.
PR-B (queryPaidValueCentsByCampaign + trueRoas preference) is DEFERRED (partly inert until the
deposit loop populates paid value). Branch: feat/spec1b-1b2a-scorer-gate off main 30529c49.
Authority: act-leg auto-merge BUT touches `**/migrations/**` (backfill) = merge-stop glob →
SURFACE-before-merge (human merge call).

## Semantics (locked — the regression-prone part)

- The gate's purpose: score only moves that ACTUALLY executed. Machine path (markActedByExecution,
  recommendation-store.ts:339) stamps executedAt ONLY on a confirmed Meta write (1B-1.5b step 10);
  an approved-but-failed reallocation (recovery_required) never calls it → stays unscored. Good.
- Operator path (applyAct, recommendation-store.ts:241-249) currently sets status="acted" + resolvedAt
  but NOT executedAt. An operator transition TO "acted" IS an execution → must stamp executedAt, or
  the gate drops all operator-acted recs (pause/creative). Stamp executedAt=resolvedAt(now) ONLY when
  toStatus==="acted" (other transitions leave it null — nothing executed).
- Backfill: existing operator-acted rows have executedAt=null → UPDATE executedAt=resolvedAt WHERE
  status='acted' AND executedAt IS NULL AND resolvedAt IS NOT NULL. Makes historical acts scorable.
- Net: every genuinely-executed act (machine confirmed-write OR operator act) scores; approved-but-
  unexecuted machine moves do not. Operator scoring preserved (no regression).

## Anchors (verified vs main 30529c49)

- Scorer: `packages/db/src/recommendation-outcome-store.ts` findAttributableCandidates where @257-264; findOverlapsForCampaign where @283-290. Both filter sourceAgent:"riley", status:"acted", intent startsWith "recommendation.", resolvedAt. ADD `executedAt:{ not: null }` to BOTH.
- Operator writer: `packages/db/src/recommendation-store.ts` applyAct update data @243-248 (no executedAt). Machine writer markActedByExecution @339 already sets executedAt.
- Migration template (DATA update): `packages/db/prisma/migrations/20260606090000_revenue_origin_marker/migration.sql` (ALTER + UPDATE). Column + index already exist (20260614140000_spec1b_reallocation_marker). Hand-write a backfill-only migration; `migrate deploy` + `db:check-drift`.
- db tests = mocked Prisma (no Postgres in CI). recommendation-outcome-store.test.ts + recommendation-store.test.ts harnesses.

## Steps (test RED first, then impl)

- [ ] S1 OPERATOR executedAt (L4): applyAct — compute `const now = new Date()` once; set resolvedAt=now and, when `args.toStatus === "acted"`, ALSO `executedAt: now`. RED: applyAct→acted update data includes executedAt; applyAct→(dismissed/other) update data OMITS executedAt. (`--filter @switchboard/db test`) [+ `--filter api test` if an app spy asserts applyAct's exact data shape.]
- [ ] S2 SCORER gate (L4): add `executedAt: { not: null }` to findAttributableCandidates @257-264 AND findOverlapsForCampaign @283-290 where blocks. RED: findMany called with where containing executedAt:{not:null} (both methods); assert via the mocked-prisma findMany spy args.
- [ ] S3 BACKFILL migration: hand-write `packages/db/prisma/migrations/<ts>_spec1b_backfill_executed_at/migration.sql` = `UPDATE "PendingActionRecord" SET "executedAt"="resolvedAt" WHERE status='acted' AND "executedAt" IS NULL AND "resolvedAt" IS NOT NULL;` (ts AFTER 20260614140000). `prisma migrate deploy` + `pnpm db:check-drift` (live PG). NO schema/DDL change (column exists) ⇒ migrate diff would be empty; this is a data-only migration authored by hand.
- [ ] S4 PAUSE-STILL-SCORES test: a higher-level test proving an operator-acted pause (applyAct→acted, now stamping executedAt) is RETURNED by findAttributableCandidates (mock a row with executedAt set + resolvedAt past cutoff → found; same row with executedAt null → excluded). Pins the no-regression invariant + the gate effect in one test.
- [ ] S5 VERIFY: typecheck; `--filter @switchboard/db test` (+ `--filter api test`); lint; format; arch; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm db:check-drift` (schema/migration); `pnpm eval:riley` (scorer feeds the engine? it's attribution — run defensively); build. Independent fresh-context review (regression-prone scorer). SURFACE-before-merge (migration stop-glob).

## Risks to pin (review lens)

- applyAct stamps executedAt ONLY for toStatus="acted" (not dismissed/expired) — else non-executions score.
- BOTH scorer methods gated (findOverlaps too) — a half-gate would mis-detect overlaps.
- backfill predicate must include `resolvedAt IS NOT NULL` (acted rows always have resolvedAt, but guard).
- updateMany/no-match: applyAct uses `update` (single) with P2025 catch — unchanged; don't convert.
- the gate is a where-tightening: confirm no other caller of these scorer methods expects pre-gate rows.
