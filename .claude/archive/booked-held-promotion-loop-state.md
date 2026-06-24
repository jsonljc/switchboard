# booked->held receipt promotion loop — externalized state (orchestration scratch, not committed)

Durable record lives in [[project_revenue_proof_direction]] + [[project_show_rate_recovery]] + [[project_receipted_bookings_architecture]].

Goal: promote a calendar Receipt booked->held when attendance is recorded "attended", so the "held" status (defined but never produced) becomes real and the attendance arc welds to the receipt primitive.
Authority: autonomous-with-guardrails (auto-merge IF all gates green + independent review zero findings >=warn + no merge-stop glob touched; else surface).
Task-size: standard (one bounded PR).
Base: origin/main @ 861399f5 (re-fetched) baseline_sha: 861399f5
merge_safety: stop-glob touched=NO (no prisma migration; not auth/consent/payment/governance/credential/send) -> re-verify on real diff before merge. independent_review=pending

## Ground-truth brief (tool-confirmed on origin/main 861399f5)

- mint-calendar-receipt.ts:42 always mints status "booked" (R2). Nothing ever sets "held"; is-paid-visit.ts returns held = (calendar && status==="held"), so held is defined-but-dead.
- recordAttendance (prisma-booking-store.ts:186) writes Booking.attendance only; never touches Receipt. Handler buildRecordAttendanceHandler (operator-intents/attendance.ts) takes a BookingAttendanceWriter; constructed at operator-intents.ts:213 with only bookingAttendanceWriter.
- PrismaReceiptStore (prisma-receipt-store.ts) has mint + findByBooking; NO update/promote. ReceiptStore interface (core/receipts/receipt-store.ts) likewise.
- PrismaReceiptStore already instantiated app.ts:881 (prismaReceipts); receiptWriter dep is write-only (mint adapter app.ts:898). Need a separate promoter capability.
- Held-rate read (#1042) computes from Booking.attendance, NOT Receipt.held -> promoting the receipt does not change the report (no regression); it makes the primitive truthful for future Ledger/1B consumers.

## Plan (TDD)

| step                            | done-condition (test/cmd)                                                                                           | RED proof | status | evidence |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- | ------ | -------- |
| T1 db promote method            | --filter db test green; updateMany where {org,bookingId,kind:calendar,status:booked} set held; count0 -> 0 no throw | needed    | todo   |          |
| T2 handler promotes on attended | --filter api test green; attended->promoter called, no_show->not called, absent->ok, throws->propagates             | needed    | todo   |          |
| T3 wiring                       | --filter api typecheck green; operator-intents.ts passes promoter, app.ts adapter; existing tests green             | n/a       | todo   |          |
| T4 VERIFY                       | all gates + independent review clean                                                                                | n/a       | todo   |          |

gate_results: typecheck=PASS test=PASS(api2019 incl 6 new; db receipt 7/7) lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS review=ZERO-findings(opus, all 6 AC verified)
merge_safety: stop-glob touched=NO (confirmed on real 6-file diff). independent_review=PASS. divergence: rebased onto origin/main after #1053 (no file overlap), fast gates re-green.
Known flakes seen (diff-independent, ignored): chat gateway-bridge-attribution (attribution-under-load), db pg_advisory_xact_lock.
PR: #1054 (4689f5a1) auto-merge ARMED (squash); BLOCKED only on in-progress CI.
carry_forward: NEXT after this = receipted-booking object spec (Ledger) to unblock exceptions[]/attribution_confidence/source_evidence[].

## Log

- 2026-06-14: ORIENT done (receipt is a proof primitive, reconciliation object absent; exceptions[] reframed). User picked booked->held promotion. FRAME done. -> PLAN/EXECUTE.
- 2026-06-14: T1 db promote method (RED->GREEN), T2 handler (RED->GREEN), T3 wiring. VERIFY: all gates green + independent review zero findings. #1053 landed mid-build (no overlap) -> rebased + re-verified. PR #1054 opened, auto-merge armed.
- 2026-06-14: #1054 MERGED (squash 618ee498) on green CI. Local hygiene: main ff-pulled, 3 merged session branches deleted (feat/receipt-booked-held-promotion, docs/revenue-proof-direction, docs/provisioning-runbook), prune dropped 3 remote refs. Memory updated (show_rate + revenue_proof_direction). SLICE DONE. Worktrees left untouched (parallel session active in spec1b-act-loop). SESSION CLOSED. NEXT = Ledger/receipted-booking object spec.
