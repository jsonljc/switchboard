# revenue-proof e2e SLICE 2 (paid leg) loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_north_star_activation_gap (P3.3 de-risk lane).

Goal: Prove the PROVEN-PAID leg e2e — book -> booking.record_attendance (Receipt booked->held) -> payment.record_verified (paid Receipt + LifecycleRevenueEvent + outbox) through REAL PlatformIngress.submit + REAL operator-mutation handlers + REAL Prisma-backed stores over the slice-1 substrate; read back through GET /reports -> owner receiptedBookingRevenue tile; assert paidRevenueCents + paidBookings + the booked->held promotion.
Authority: autonomous-with-guardrails (auto-merge ONLY if all gates green + independent review 0 findings>=warn + divergence clean + high confidence; else SURFACE). Task-size: standard (test-only + test-harness extension).
Base: origin/main @ 464d82e4f (re-fetched) baseline_sha: <set at PLAN>
merge_safety: stop-glob touched = NO (files: revenue-loop-substrate.ts, revenue-loop-substrate.test.ts, revenue-proof-paid-leg-e2e.test.ts, test-server.ts — none match _payment_/_governance_/_auth_/prisma/etc.). Exercises money path -> keep bar high, review must re-derive paid value. independent_review=<pending>

## Ground truth (tool-verified)

- bootstrapOperatorIntents ALREADY accepts receiptWriter/paymentVerifier/receiptHeldPromoter (operator-intents.ts:136-147,248-264). Only test-server.ts BuildTestServerOptions lacks them -> extend the TEST HARNESS (test-only).
- Gate: payment.record_verified is system_auto_approved + write + INBOUND (NOT financial: governance-gate.ts:84-88,125-126) -> short-circuits to execute at L182-189 BEFORE loadIdentitySpec(L206). So a {id:"system",type:"service"} actor needs NO seeded spec. Handler enforces service/system actor (F3). Attendance same short-circuit.
- Submit shape (booking-attendance.ts:57): app.platformIngress.submit({intent,parameters,actor,organizationId,trigger:"api",surface:{surface:"api"},idempotencyKey}).
- Paid derivation: compute-receipted-booking-revenue.ts -> paidBookings=count(v.paid), paidRevenueCents=sum(v.paidValueCents); getView -> computeBookingPaidValue -> isPaidVisit.paid = kind=payment && provider!=="noop" && status=="paid" && tier=="T1_FETCH_BACK". PSP fetch-back amount (charge.amountCents) is the money authority, NOT request body.
- Real wiring to mirror (app.ts:1048-1064): outboxWriter=PrismaOutboxStore.write; runInTransaction=$transaction; receiptWriter=PrismaReceiptStore.mint; receiptHeldPromoter=same PrismaReceiptStore; paymentVerifier=PSP fetch-back.
- Booking tx touches client models: booking.update, outboxEvent.create, receipt.create, opportunity.updateMany, contact.findFirst, receiptedBooking.find/create (calendar-book.ts:437-491, issue-receipted-booking.ts) -> KEEP outboxEvent.create, ADD createMany.

## Substrate extensions (test-driven, each by a REAL query)

1. lifecycleRevenueEvent STATEFUL: findFirst (PrismaRevenueStore.record idempotency where {org,externalReference}) + create + findMany honoring where {org,bookingId} (getView paymentEventIds, currently []).
2. outboxEvent.createMany({data,skipDuplicates}) dedup on eventId (PrismaOutboxStore.write). KEEP create (booking path).
3. Throw-guard on unmodeled client METHODS + models (Proxy -> "model it before use"), not just where-operators.
4. matchWhere bare-Date EQUALITY arm (getTime compare) so a Date equality where matches by time, not throw/reference.
5. Co-located revenue-loop-substrate.test.ts (matcher + guard + stateful revenue-event + outbox dedup).
6. Close slice-1 distinct-decoy hole: 2nd booked calendar receipt sharing the REAL bookingId (seeded AFTER booking) -> count stays 1.

baseline_sha: 464d82e4f worktree: .claude/worktrees/revenue-proof-paid-leg branch test/revenue-proof-paid-leg

| step                          | done-condition (test/cmd)           | RED proof                                                                           | status | evidence                                                                   |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| 1 substrate ext + unit test   | revenue-loop-substrate.test green   | 8 failed (create/createMany undefined, bare-Date->operator-throw, opaque TypeError) | DONE   | 9/9 green; slice-1 still 4/4 (backward-compat)                             |
| 2 test-server 3 options       | payment/attendance intents register | (folded into e2e RED)                                                               | DONE   | receiptWriter/paymentVerifier/receiptHeldPromoter threaded                 |
| 3 attendance booked->held e2e | real submit -> receipt held         | n/a (handler pre-exists)                                                            | DONE   | outcome completed, receiptsPromoted=1, receipt held                        |
| 4 payment->paid tile e2e      | GET /reports paidRevenueCents=30000 | FALSIFIED: skip payment -> paymentReceipt undefined -> RED                          | DONE   | 5/5 green; ModeRegistry dispatched real operator_mutation for both intents |

gate_results: typecheck=PASS test(api 2330/0, +14 new)=PASS lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS review=PASS(0 findings>=warn)
merge_safety: stop-glob touched=NO (4 files all apps/api/src/**tests**/\*). independent_review=PASS — agent re-derived paidRevenueCents=30000/paidBookings=1/revenueCents=45000/cohortSize=1 (MATCH) + mutation-verified all 3 decoys load-bearing in throwaway worktree + confirmed payment intent reaches EXECUTION via gate short-circuit. confidence=HIGH.
commit: d79ce7073 rebased onto origin/main 6e433a41d (PR #1223 advanced base under me; clean rebase, api files no overlap with #1223 dashboard).
carry_forward: VERIFY done, ALL gates green + review PASS. Authority=autonomous-with-guardrails -> conditions MET -> CONVERGE via PR+CI then squash-merge after final divergence re-check. 2 TS errors fixed mid-VERIFY (unused param + brittle ReturnType<inject> interface -> inferred). reset!=build: needed full pnpm build for ad-optimizer (dashboard-reports.ts imports it).

## Log

- 2026-06-21: ORIENT done (ground truth tool-verified, collision scan clean: no PR/worktree on slice 2). FRAME light. -> worktree + PLAN.
- 2026-06-21: EXECUTE done. Substrate unit RED->GREEN (9/9); test-server extended; slice-2 e2e 5/5 (real ingress dispatch confirmed via stderr); paid claim falsified-then-restored; slice-1 regression-clean. -> VERIFY.
- 2026-06-21: VERIFY done. All gates green (typecheck/api-test 2330-0/lint/format/arch/verify-fast/security/build). Fixed 2 tsc errors (unused param, brittle ReturnType<inject>). Rebased onto origin/main 6e433a41d (PR #1223 advanced base). Independent Opus review PASS: re-derived paid numbers MATCH + mutation-verified 3 decoys load-bearing + confirmed gate-execution. -> CONVERGE: pushed, opened PR #1224, watching CI. Authority conditions MET -> squash-merge after CI green + final divergence re-check.
- 2026-06-21: CONVERGE done. CI ALL 15 checks pass (test 10m49s/typecheck/lint/security/architecture/docker/CodeQL/evals). Final divergence re-check CLEAN (origin/main still 6e433a41d; only #1224 touches the 4 files). **SQUASH-MERGED PR #1224 -> main f82fbd0365.** Worktree removed, branch deleted (remote auto-deleted), local main ff-synced. Memory note updated (P3.3 slice 2 DONE; slice 3 = digest+delivery is the last). SLICE COMPLETE. Plan-doc #1211 checkbox left for next ORIENT (no CI PR burned, per A3 precedent).
