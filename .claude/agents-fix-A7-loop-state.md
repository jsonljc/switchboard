# A7 proof-chain integrity loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_all_agents_improvement_audit + moc_governance.

Goal: Proof-chain integrity — stamp approvalId on the approved trace (rank5), inverse no_show receipt
demote (rank12), single cohort assembly in period-rollup (rank19). rank11 = already done on main.
Authority: autonomous-with-guardrails BUT A7 touches merge-stop (governance/work-trace + receipt-proof)
=> DEFAULT SURFACE-before-merge. Task-size: standard (one bounded PR).
Base: origin/main @ 2205fcccf (re-fetch each slice) baseline_sha: <set at PLAN>
merge_safety: stop-glob touched=YES (work-trace update path rank5; receipt-proof rank12) => SURFACE.
independent_review=<pending>

## ORIENT brief (tool-backed, 2026-06-22)

- #782 (work-trace-bypass-guard) overlap: NONE. #782 guards buildWorkTrace CONSTRUCTION; rank5 changes
  the WorkTraceStore.update path (writeApprovedPayloadToTrace). #782's own docstring says update/finalize
  paths do NOT pass its guard. Different files (work-trace-recorder.ts vs approval/lifecycle-dispatch.ts).
- No live worktree on lifecycle-dispatch/receipt/period-rollup/attendance (worktrees: a12-riley, ai-s8a,
  alex-north-star, audit-dashboard, readme, view-main, work-trace-bypass-guard — all disjoint).
- rank5 REAL: lifecycle-dispatch.ts:61-68 update omits approvalId. WorkTrace.approvalId?:string exists
  (work-trace.ts:26); update takes Partial<WorkTrace>. Consumer prisma-receipted-booking-store.ts:138,234
  -> humanApprovalId (schema receipted-booking.ts:101), null today. Callers respond-via:140 + parked:168
  both pass lifecycle w/ .id (lifecycle-types.ts:9). Fix: approvalId: lifecycle.id.
- rank11 DONE: mirror-comment schema.prisma:2131-2136 (cols+WHERE+migration+Prisma6+"keep in sync"),
  equivalent to LifecycleRevenueEvent:1901-1903. Behavioral dedup already tested
  prisma-receipt-store.test.ts:98-127. Index-name existence test = no Postgres in CI / no precedent /
  immutable migration -> NOT inventing it.
- rank12 REAL: attendance.ts:59-64 promotes only on "attended"; no inverse on "no_show". Store has
  promoteCalendarBookedToHeld (prisma-receipt-store.ts:63-74), no demote. Existing test attendance.test.ts:67
  asserts promote NOT called on no_show. Fix: add demoteCalendarHeldToBooked + call on no_show.
- rank19 REAL: compute-quality.ts:73 + compute-revenue.ts:23 each call listForCohort({orgId,from,to})
  independently => double N+1 assembly + divergent now (adapter app.ts:708-711 maps obj->positional,
  defaults now per call). e2e (revenue-proof-paid-leg-e2e.test.ts:198) goes through createPeriodRollup.
  Fix (minimal): period-rollup assembles cohort ONCE, passes views to both compute fns. Interface,
  app.ts adapter, prisma store, test-server mock UNCHANGED.

## SCOPE DECISION (the brainstorming output)

ONE PR, theme "proof-chain integrity", SURFACE-before-merge. Contents: rank5 (headline) + rank12 + rank19.
rank11 = report DONE (already mirrored + behavior tested). NOT splitting / no auto-merge sub-slice:
rank5 is governance/work-trace (merge-stop) + rank12 is receipt-proof path -> whole unit surfaces anyway;
bundling avoids stacked-PR hazards + 4 round-trips; the three are cohesive; human makes one merge call.

| step                            | done-condition (test/cmd)                                                                           | RED proof | status | evidence |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | --------- | ------ | -------- |
| 1 rank5 stamp approvalId        | new lifecycle-dispatch.test asserts update carries approvalId:lifecycle.id; +1 parked-caller assert | yes       | todo   |          |
| 2 rank12 demote on no_show      | store demoteCalendarHeldToBooked test + attendance handler no_show-demotes test                     | yes       | todo   |          |
| 3 rank19 single cohort assembly | period-rollup calls listForCohort once; compute fns take views; tests updated green                 | yes       | todo   |          |

gate_results: typecheck=PASS test=PASS(4 chat-attribution fails = KNOWN under-load flake; isolated 4/4
PASS; diff disjoint) lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS(10/10)
eval=n/a review=REVISE(1 real finding, triaged). Commit c1be537aa (13 files). SURFACE-before-merge.

INDEPENDENT REVIEW (fresh-context opus) -> triaged:

- rank12 + rank19: SHIP-clean (org-scoped demote; intended 0-count no-op; behavior-preserving dedup; all
  4 ReceiptHeldPromoter mocks updated; no dead imports). rank5 stamp CORRECT (one-shot first-set/
  idempotent; lifecycle.id; no #782 overlap).
- rank5 BLOCKER = real but PRE-EXISTING + OUT OF SCOPE: receipted-booking view's workTrace leg
  (traceId/matchedPolicies/humanApprovalId) is null for ALL bookings because the consumer joins WorkTrace
  by PK id (prisma-receipted-booking-store.ts:137) while producers store a non-id value into
  Booking.workTraceId (calendar-book.ts:360->workUnitId; riley-budget-executor.ts:32->traceId).
  WorkTrace.id=@default(cuid()) != workUnitId(@unique) != traceId. PRE-EXISTING on origin/main (git show).
  Plan scoped rank5 "MOOT today, assert TRACE field" -> stamp IS the deliverable. DECISION
  (receiving-code-review + brief do-NOT-expand-scope): keep stamp, do NOT fix join/producer reconciliation
  here (separate slice = canonical Booking.workTraceId + backfill + consumer join). Commit msg corrected;
  surfaced as follow-up A7b.

## Log

- 2026-06-22: ORIENT complete. Ground truth verified on origin/main @ 2205fcccf. rank11 already done.
  Scope = rank5+rank12+rank19 in one SURFACE-before-merge PR.
- 2026-06-22: EXECUTE 3 steps RED->GREEN. VERIFY all gates green (chat flake confirmed). Independent
  review REVISE -> the one real finding is a PRE-EXISTING out-of-scope consumer join bug; kept the
  in-scope stamp + corrected framing + surfaced A7b. Commit c1be537aa. -> push + SURFACE PR.
