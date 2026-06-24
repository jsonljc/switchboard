# receipted-booking-quality loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_revenue_proof_direction.

Goal: First owner-facing CONSUMER of the receipted-booking read-projection — a weekly proof-quality
surface on the owner report (attribution-confidence breakdown + exceptions worklist), consuming
slice-4 PrismaReceiptedBookingStore.listForCohort.
Authority: AUTONOMOUS-WITH-GUARDRAILS (auto-merge iff gates green + zero >=warn review findings +
no stop-glob touched + high confidence; else SURFACE).
Task-size: standard (one bounded PR).
Base: origin/main @ fb7c87ae (re-fetched 2026-06-15). baseline_sha: fb7c87ae
merge_safety: stop-glob touched=NO (predicted set: schemas/core/db reports + apps/api/app.ts +
dashboard results tiles; none match prisma/ migrations/ auth/ money/ consent/ credential/ governance/
send/ allowlist globs). independent_review=pending

| step                       | done-condition (test/cmd)                                    | RED proof                                  | status | evidence |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------ | ------ | -------- |
| 1 schema type              | `--filter @switchboard/schemas test` green                   | reports-v1.test assertion on missing field | todo   |          |
| 2 compute fn               | `--filter @switchboard/core test` (new test) green           | module-not-found                           | todo   |          |
| 3 rollup wiring + literals | `--filter @switchboard/core test` + typecheck green          | period-rollup.test toEqual missing field   | todo   |          |
| 4 api wiring               | `--filter @switchboard/db @switchboard/api` typecheck green  | n/a (mechanical)                           | todo   |          |
| 5 dashboard model+tile     | `--filter @switchboard/dashboard test` (new tile test) green | tile-test render assertion                 | todo   |          |
| 6 dashboard page+css       | `--filter dashboard build` (next build) green                | n/a (wiring)                               | todo   |          |

gate_results: typecheck=· test=· lint=· format=· arch=· verify-fast=· security=· build=· review=·
carry_forward: Data plane shipped slices 1-4 (#1062/#1066/#1067/#1070). This is the FIRST consumer of
getView/listForCohort. New field = ReportDataV1.receiptedBookingQuality (cohortSize + confidence
Record<AttributionConfidence,number> + exceptions Record<ExceptionCode,number> open-only +
bookingsNeedingAttention). New ReportStores key = receiptedBookings.listForCohort (PrismaReceiptedBookingStore
adapter, app.ts). Pure aggregation compute fn (reuses store-derived confidence/exceptions, no scoring
re-impl). Dashboard = new ProofQuality section after ConsentCompletenessTile.

## Log

- 2026-06-15: ORIENT+FRAME done. Ground truth mapped (2 Explore sweeps + direct reads). Cut chosen
  (option B: breakdown + worklist-counts as new compute fn/field/section; rejected count-tile-extend
  and per-booking PII drill-down). PLAN written. -> EXECUTE.
- 2026-06-15: EXECUTE done. Commit 1 (data plane, f73844ab pre-rebase), commit 2 (dashboard, 9be54c82),
  commit 3 (review fixes, 14325c94). TDD: real RED for compute fn + tile. -> VERIFY.
- 2026-06-15: VERIFY done. Verifier subagent ALL GREEN (build/typecheck/lint/format/arch/verify-fast/
  test/dashboard-test/security). Independent reviewer: 1 warn (cohort-equality doc overstatement) + 2
  nits (worklist entry-vs-booking count; comment em-dashes) -> all fixed (commit 3, +dedupe test) ->
  fresh reviewer VERDICT CLEAN. -> CONVERGE.
- 2026-06-15: CONVERGE. origin/main advanced fb7c87ae->cf2f7b1a (#1072 ad-optimizer, DISJOINT, 0
  conflicts). Rebased clean. PR #1074 opened, squash auto-merge + delete-branch enabled. No merge-stop
  glob touched. Awaiting required CI, then sync main + prune + memory note.
