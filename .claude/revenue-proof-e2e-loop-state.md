# revenue-proof whole-loop e2e — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_north_star_activation_gap (P3 / de-risk lane).

Goal: author the FIRST whole-loop revenue-proof e2e (capstone after P3.1 #1198 + P3.2 #1200/#1201).
Authority: autonomous-with-guardrails (run superpowers chain; auto-merge ONLY if every gate green + indep review 0 findings >=warn + clean divergence + high confidence; else surface).
Task-size: MULTI -> decomposed into a docs plan PR + 3 slices; EXECUTE slice 1 only.
Base: origin/main @ 6a7d3c083 (re-fetched 2026-06-21) baseline_sha: 6a7d3c083
merge_safety: stop-glob touched = NO (test-only files; no payment/auth/governance/prisma in paths) independent_review = PASS (4th fresh-context review this session: APPROVE, 0 findings >=warn, 2 nits only, + dynamic decoy proof 1-of-6 survives)

## Decision (FRAME, user-approved via AskUserQuestion 2026-06-21)

- Decompose; land a decomposition plan doc as its OWN small PR (docs/superpowers/plans/2026-06-21-revenue-proof-e2e-decomposition.md).
- Slice 1 = booking-producer -> receipt -> receipted-booking issuance -> owner revenue+quality tiles, over a NEW reusable in-memory Prisma substrate. Closes the write->read gap P3.2 left open (P3.2 fed the read projection a MOCKED prisma; nothing proves Alex's booking WRITE populates it).
- Booking entry = REAL `calendar-book` tool op `booking.create` invoked directly (LLM + skill-executor bypassed; booking has NO intent path anyway). LLM/Google-Calendar/Prisma are the mocked external edges.

## Ground-truth (tool-backed, ORIENT)

- Producer: `createCalendarBookToolFactory(deps)` from `@switchboard/core/skill-runtime`; `factory(ctx).operations["booking.create"].execute({service,slotStart,slotEnd,calendarId})`. In ONE `deps.runTransaction(fn)`: booking.update(confirmed) + outboxEvent.create(booked) + receipt.create(calendar/booked/T1, via buildCalendarReceiptData) + opportunity.updateMany(stage=booked) + issueReceiptedBookingInTx (persists ReceiptedBooking: attributionConfidence + exceptions + expectedValueAtIssue snapshot).
- `buildCalendarReceiptData` does NOT set createdAt -> substrate.receipt.create MUST stamp createdAt = data.createdAt ?? new Date() (the cohort window filter keys on it).
- Read: `PrismaReceiptedBookingStore(substrate)` (db barrel). getView reads booking/receipt(findMany)/conversionRecord/contact/lifecycleRevenueEvent/opportunity/workTrace/receiptedBooking, all org-scoped. listForCohort = receipt.findMany({org,kind:calendar,status in [booked,held],createdAt in [from,to),bookingId not null}, select bookingId, distinct[bookingId]) then getView per booking.
- Count tile uses `PrismaReceiptStore(substrate).countReceiptedBookingsInWindow` (db barrel). SAME cohort -> count === listForCohort length.
- Route seam (P3.2 proven): buildTestServer() then set app.reportStores.receipts.countReceiptedBookingsInWindow + app.reportStores.receiptedBookings.listForCohort to REAL stores over the substrate; GET /api/dashboard/reports?window=THIS%20WEEK -> createPeriodRollup -> receiptedBookings/receiptedBookingRevenue/receiptedBookingQuality tiles.
- Reference for constructing calendar-book deps in a test: apps/api/src/bootstrap/**tests**/calendar-provider-factory.integration.test.ts:367.
- Determinism: vi.setSystemTime(fixed mid-week instant) so the booked receipt.createdAt lands inside the route's THIS WEEK (Asia/Singapore default tz) window.

## Slice-1 plan (TDD-shaped, ephemeral)

Files (all test-only, no production change expected):

- NEW apps/api/src/**tests**/revenue-loop-substrate.ts — in-memory Prisma fake (Maps per model) + store-subset adapters (bookingStore/opportunityStore/contactStore) + calendar-provider mock + seed builders. ONE shared state; exposes a prisma-shaped client (for PrismaReceiptedBookingStore + PrismaReceiptStore + the tx) and the calendar-book deps.
- NEW apps/api/src/**tests**/revenue-proof-e2e.test.ts — slice-1 test.

Steps:

1. RED: substrate skeleton + a failing test that books via the REAL tool op then asserts the booking + receipt + receiptedBooking rows exist in the substrate (write leg). done-cond: test red because substrate methods unimplemented.
2. GREEN: implement substrate model methods used by the tool tx (booking.update, outboxEvent.create, opportunity.updateMany, receipt.create[stamp createdAt], receiptedBooking.findFirst/create, contact.findFirst) + the store adapters + provider mock. Run the op; assert rows.
3. RED->GREEN: wire REAL PrismaReceiptedBookingStore + PrismaReceiptStore over the substrate into app.reportStores; GET /reports; assert receiptedBookings.count==1, receiptedBookingRevenue {cohortSize:1,bookingsWithValue:1,revenueCents:45000,paidRevenueCents:0,paidBookings:0}, receiptedBookingQuality {cohortSize:1,confidence.deterministic:1,exceptions all 0,bookingsNeedingAttention:0,worklist:[]}.
4. RED->GREEN (anti-vacuous): seed DECOY receipts (out-of-window booked; void; non-calendar payment; another-org) directly into substrate; assert cohort stays 1 (proves the listForCohort + count filters genuinely filter, substrate is not a rubber stamp).
5. REFACTOR: tidy substrate; keep each file < 400 lines (arch:check errs at 600 raw .ts lines); extract seed builders if needed.

Seed for the happy booking: org "org-1"; contact {id, leadgenId:"lead-1" (=> deterministic), pdpaJurisdiction:null (=> no missing_consent), name/email, attribution chain}; active Opportunity {id, estimatedValue:45000, stage pre-booked}. No payment receipt (paid=false). Expect expectedValueAtIssue=45000.

| step | done-condition (test/cmd)         | RED proof                  | status | evidence |
| ---- | --------------------------------- | -------------------------- | ------ | -------- |
| 1    | write leg books + persists 3 rows | substrate unimpl -> throws | todo   |          |
| 2    | substrate impl; rows asserted     |                            | todo   |          |
| 3    | route tiles == seeded numbers     | tiles wrong w/o real store | todo   |          |
| 4    | decoys excluded; cohort==1        | cohort==N w/o filter       | todo   |          |
| 5    | refactor; files < cap             |                            | todo   |          |

gate_results: typecheck=PASS test=PASS(api 2309) filter-api=PASS lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS review=PASS(0 >=warn, 4 rounds incl. final fresh-session APPROVE+dynamic proof) | CI required (typecheck/lint/test/security)=PASS; architecture=PASS (after 1 infra-flake rerun)
carry_forward: SLICE 1 DONE. Docs plan PR #1211 MERGED (decomposition on main). Impl PR #1214 OPEN (branch test/revenue-proof-e2e-s1 @ c10ded626, REBASED onto current main a49f97cbe + re-verified against #1212's new phoneE164 duplicate-detection -> compatible, 4 tests green). Required-checks watch = bg task bcuk9ir0n; AUTO-MERGE on green per user bar (all conditions met: gates green, review 0>=warn, divergence clean, confidence high, no merge-stop glob). Files: apps/api/src/**tests**/{revenue-proof-e2e.test.ts, revenue-loop-substrate.ts} (test-only). Substrate = InMemoryRevenueDb (Maps + matchWhere/matchOperator/matchRange throw-on-unmodeled + buildCalendarBookTool). Slice 2 = attendance(booking.record_attendance) + payment(payment.record_verified, inject PaymentVerifier) -> paid tile via REAL PlatformIngress (reuse substrate). Slice 3 = buildWeeklyDigest + ledger.deliver_weekly_report via REAL PlatformIngress (inject EmailSender). KNOWN nits DEFERRED to slice 2 (reviewer-classed, not >=warn): (a) matchWhere throws on a bare-Date equality where (no slice-1 query uses it; add `&& !(cond instanceof Date)` in slice 2/3 WITH a test if needed); (b) no decoy guards the cohort `distinct:["bookingId"]` clause -> in slice 2 add a 2nd booked calendar receipt sharing the real booking's id (seed AFTER booking, id is dynamic) and assert count stays 1; (c) substrate findMany ignores `select` (harmless: absent cols read undefined->null == real NULL). >>> SLICE 1 COMPLETE: #1214 MERGED to main as cc6fd4645 (2026-06-21T02:30Z, squash, 602 insertions, test-only); worktree+branch removed + main ff-synced (by prior watch bcuk9ir0n, re-verified this session). Architecture CI flaked once ("runner lost communication" infra) -> reran green before merge.

## Log

- 2026-06-21: ORIENT done (collision scan clean; chain mapped; no whole-loop e2e exists). FRAME done (decompose + slice-1 = booking->tiles, real tool op; user-approved via AskUserQuestion). Decomposition plan PR #1211 opened+MERGED. Slice 1 EXECUTE: TDD (substrate + 4-test e2e); RED proof via filter-sabotage (decoy count 6 vs 1). VERIFY: 8/8 gates green; 3 independent fresh-context reviews (round1: 1 warn vacuous-Number.isFinite; round2: 2 warns NaN-overclaim + decoy-not-isolating, found via live mutation testing; final: 0 >=warn, empirically proved clause isolation + non-vacuity). Fixes: removed vacuous line, removed over-claiming NaN test (P3.2 owns tile NaN), isolated payment decoy to kind clause, hardened matcher (throw on unmodeled op). CONVERGE: origin/main advanced 6a7d3c083->a49f97cbe under me; #1212 touched my deps (issue-receipted-booking + receipted-booking-store) -> REBASED + rebuilt + re-verified (4 tests + full api 2309 + typecheck 22/22 green against new code). Impl PR #1214 opened, force-pushed rebased, CI watch backgrounded. Docs #1211 merged + worktree removed.
- 2026-06-21 (CONVERGE, fresh session): re-fetched; main advanced a49f97cbe->147a93da7 (only docs #1215 + #1211, no overlap). Pre-merge divergence re-check: `git merge-tree` clean; three-dot diff = 2 test files / 602 insertions / 0 deletions; NO merge-stop glob. Required checks (typecheck/lint/test/security) all PASS; architecture NON-required (UNSTABLE=mergeable) and finishing (health+dep-boundary steps already green). 4th independent fresh-context adversarial review (opus, did NOT see my reasoning) = APPROVE, 0 findings >=warn, 2 nits [distinct-clause has no guarding decoy; substrate findMany ignores select], + DYNAMIC proof (scratch run: 1 of 6 receipts survives the real stores' filter). All auto-merge conditions met -> waiting on architecture to conclude green, then squash-merge.
- 2026-06-21 (CONVERGE cont.): architecture job concluded FAILURE, but annotation = "hosted runner lost communication with the server" = pure GHA infra flake, NOT code (the substantive steps Architecture-health-check + Dependency-boundary-validation already concluded success; runner died mid Route-governance; my diff is test-only, touches no routes/.agent-tools; local verify-fast already PASS). Reran via `gh run rerun 27889770018 --failed` (only architecture re-runs; CodeQL run 27889770036 stays green). Polling rerun to terminal conclusion (bg btrk7shr0). On green -> final divergence re-check -> squash-merge.
- 2026-06-21 (CONVERGE done): architecture rerun = SUCCESS (~180s). Pre-merge re-check: origin/main steady @147a93da7, three-dot diff still 2 test files, merge-tree clean, mergeStateStatus flipped UNSTABLE->CLEAN. PR #1214 MERGED (squash cc6fd4645, 602 insertions test-only) at 02:30:03Z -- prior watch bcuk9ir0n auto-merged on green (per user bar) moments before my own `gh pr merge` (which reported "already merged"); same outcome/authority/verified-conditions. Confirmed cc6fd4645 ancestor of origin/main + contains exactly the 2 files + remote branch auto-deleted. Cleanup (worktree remove + prune + local branch -D + main ff-sync) already done by bcuk9ir0n; re-verified clean. SLICE 1 COMPLETE.
