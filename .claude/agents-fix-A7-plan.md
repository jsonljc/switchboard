# A7 — Proof-chain integrity (TDD plan, ephemeral scratch)

Slice: rank5 (approvalId stamp) + rank12 (no_show receipt demote) + rank19 (single cohort assembly).
rank11 reported DONE-on-main (mirror-comment schema.prisma:2131-2136 + behavioral dedup test exists).
Authority: SURFACE-before-merge (governance/work-trace + receipt-proof = merge-stop). One PR.
Branch: `fix/proof-chain-integrity-a7` off fresh origin/main, worktree `.claude/worktrees/a7-proof-chain`.

Invariants held: PlatformIngress sole mutating entry (unchanged); WorkTrace canonical (rank5 is an
additive field on the EXISTING approved-trace update, not a new write path); approval lifecycle behavior
unchanged (we stamp a field, do not alter transitions); layers schemas->core->db->apps (no new cross-layer
edge); no #782 interaction (update path, not buildWorkTrace construction). All changes additive.

---

## Step 1 — rank5: stamp `approvalId: lifecycle.id` on the approved-trace update

Files: `packages/core/src/approval/lifecycle-dispatch.ts` (impl),
`packages/core/src/approval/__tests__/lifecycle-dispatch.test.ts` (NEW, primary RED),
`packages/core/src/approval/__tests__/respond-to-parked-lifecycle.test.ts` (extend: 1 wiring assert).

RED (write first, watch fail):

- NEW `lifecycle-dispatch.test.ts`: unit-test `writeApprovedPayloadToTrace` with a mock `workTraceStore`
  whose `update` returns `{ ok: true, trace: ... }`. Build a `LifecycleRecord` fixture with `id:"lc-1"`,
  `actionEnvelopeId:"wu-1"`, `organizationId:"org-1"`. Call writeApprovedPayloadToTrace and assert
  `update` was called with `actionEnvelopeId` AND a fields object containing
  `approvalId: "lc-1"` (PLUS the existing parameters/approvalOutcome/approvalRespondedBy/approvalRespondedAt
  to characterize). Fails today: no approvalId key. Assert the failing line is the `approvalId` matcher.
- Extend `respond-to-parked-lifecycle.test.ts`: in the existing happy-path approve test, find the
  workTraceStore.update mock and add an assertion the update fields include `approvalId` equal to the
  approved lifecycle's id (proves `lifecycle.id` flows from the real caller). If the test does not yet
  capture update args, capture them via the existing mock (`vi.fn`) `.mock.calls`.

GREEN: in `writeApprovedPayloadToTrace`, add `approvalId: lifecycle.id,` to the fields object passed to
`deps.workTraceStore.update(...)` (alongside parameters/approvalOutcome/...). No other change.

SAFETY (verified work-trace-lock.ts:139-148): `approvalId` IS a ONE_SHOT_FIELD, but the function ALREADY
writes three one-shot fields (approvalOutcome/RespondedBy/RespondedAt). One-shot rejects only when existing
is set AND differs; approvalId is undefined on the parked path (buildWorkTrace omits it; platform-ingress
sets it only on the notification, not the trace) => first-set allowed, retry idempotent (same lifecycle.id
=> isEqual => not rejected). Cannot make a previously-OK update fail. The store already persists
fields.approvalId (prisma-work-trace-store.ts:545).

Done-condition: `pnpm --filter @switchboard/core test -- lifecycle-dispatch respond-to-parked` green;
RED seen first.

## Step 2 — rank12: inverse receipt transition on `no_show` (held -> booked)

Files: `packages/db/src/stores/prisma-receipt-store.ts` (add method),
`packages/db/src/stores/__tests__/prisma-receipt-store.test.ts` (RED store test),
`apps/api/src/bootstrap/operator-intents/attendance.ts` (interface + handler),
`apps/api/src/bootstrap/operator-intents/attendance.test.ts` (RED handler test),
`apps/api/src/app.ts` (wiring — only if the promoter is passed by an explicit interface that needs the
new method surfaced; PrismaReceiptStore satisfies structurally, so likely no app.ts change — verify).

RED (write first):

- Store test in `prisma-receipt-store.test.ts` (new `describe("demoteCalendarHeldToBooked")`): mirror the
  existing `promoteCalendarBookedToHeld` tests. Assert it issues `receipt.updateMany` with
  where `{ organizationId, bookingId, kind:"calendar", status:"held" }`, data `{ status:"booked" }`,
  returns `result.count`; and returns 0 without throwing on no match. Fails: method does not exist.
- Handler test in `attendance.test.ts` (new): promoter mock now also has
  `demoteCalendarHeldToBooked: vi.fn(async () => 1)`. Record `no_show` and assert
  `demoteCalendarHeldToBooked` was called with `("org-1","b1")` and `promoteCalendarBookedToHeld` was
  NOT. Fails: handler does nothing on no_show. ALSO update the EXISTING "does NOT promote ... no_show"
  test's promoter mock to include `demoteCalendarHeldToBooked` (else undefined-method TypeError once impl
  lands) — keep its `promote not called` assertion.

GREEN:

- Add `demoteCalendarHeldToBooked(organizationId, bookingId): Promise<number>` to `PrismaReceiptStore`,
  mirroring `promoteCalendarBookedToHeld` (updateMany held->booked, org+booking+kind=calendar scoped,
  return count, best-effort never-throws). Co-located JSDoc symmetric to the promote method.
- In `attendance.ts`: DO NOT RENAME the interface (both reviewers: `ReceiptHeldPromoter` is also imported
  in operator-intents.ts:49,147 + test-server.ts:180 — rename has a 4-site blast radius for zero gain).
  Just ADD `demoteCalendarHeldToBooked(organizationId, bookingId): Promise<number>` to the existing
  `ReceiptHeldPromoter` interface. On `params.outcome === "no_show"` AND a wired promoter, call
  `demoteCalendarHeldToBooked(org, bookingId)` (fail-loud, same posture as promote). Keep `attended`
  unchanged. Neither promote nor demote is on the core `ReceiptStore` interface, so no core change.
- Verify `app.ts` / operator-intents.ts wiring still type-checks (PrismaReceiptStore now also has demote;
  it satisfies the interface structurally).

Done-condition: `pnpm --filter @switchboard/db test -- prisma-receipt-store` +
`pnpm --filter api test -- attendance` green; RED seen first; `pnpm --filter @switchboard/db build`
(dist refresh so api tsc sees the new method) then `pnpm --filter api exec tsc --noEmit`.

## Step 3 — rank19: assemble the receipted-booking cohort ONCE in period-rollup

Files: `packages/core/src/reports/period-rollup.ts` (call listForCohort once, pass views),
`packages/core/src/reports/compute-receipted-booking-quality.ts` (take views),
`packages/core/src/reports/compute-receipted-booking-revenue.ts` (take views),
`packages/core/src/reports/compute-receipted-booking-quality.test.ts` (update to pass views),
`packages/core/src/reports/compute-receipted-booking-revenue.test.ts` (update to pass views).
NOT touched: interfaces.ts listForCohort signature, app.ts adapter, prisma store, test-server.ts mock,
e2e (goes through createPeriodRollup).

FRAME (corrected per reviewer 2): this is a PERF + CONSISTENCY refactor, NOT a now-correctness fix.
Neither compute fn reads a `now`-dependent field (quality filters `!resolvedAt` + maps `.code`; revenue
reads only value/paid). The win is eliminating the DUPLICATE N+1 `getView` fan-out (~2x DB round-trips)
and giving both dimensions ONE cohort snapshot. Behavior-preserving for both.

RED (write first):

- Change the two compute `.test.ts` to call `computeReceiptedBookingQuality(views)` /
  `computeReceiptedBookingRevenue(views)` with a `ReceiptedBookingView[]` literal (drop the mock store).
  These fail against the current `(ctx, receiptedBookings)` signature => RED. ALSO delete the now-orphaned
  top-level `ctx` const + `stores()` helper + unused `vi` import in BOTH test files (reviewer 1: else
  eslint no-unused-vars reds).
- `period-rollup.test.ts` EXISTS (stub `listForCohort: async () => []` at ~:54). Change that stub to a
  `vi.fn(async () => [])` and assert it is invoked exactly ONCE per rollup (call count === 1), proving no
  double assembly. Existing rollup assertions still hold with `[]`.

GREEN:

- `computeReceiptedBookingQuality(views: ReceiptedBookingView[])` and
  `computeReceiptedBookingRevenue(views: ReceiptedBookingView[])` — drop the internal `listForCohort` call,
  iterate the passed `views`. Keep all aggregation logic IDENTICAL. IMPORT SURGERY (reviewer 1): remove the
  now-unused `RollupContext` (and `ReportStores` where applicable) imports; add
  `import type { ReceiptedBookingView } from "@switchboard/schemas"`.
- `period-rollup.ts`: assemble ONCE via a SHARED promise so the cohort still fans out concurrently with the
  other ~8 legs (reviewer 2: avoid serializing it ahead of Promise.all):
  `const receiptedViews = deps.stores.receiptedBookings.listForCohort({ orgId, from: current.start, to: current.end });`
  then inside the `Promise.all`, replace the two calls with
  `receiptedViews.then(computeReceiptedBookingQuality)` and `receiptedViews.then(computeReceiptedBookingRevenue)`.
  `computeReceiptedBookings` (the COUNT leg, distinct store `deps.stores.receipts`) STAYS unchanged in the
  Promise.all. One assembly, full parallelism, both dimensions share one resolved cohort.

Done-condition: `pnpm --filter @switchboard/core test -- compute-receipted period-rollup` green;
`pnpm --filter api test -- revenue-proof-paid-leg-e2e` green (transparent through createPeriodRollup);
RED seen first.

## VERIFY (delegate; per build-loop §4)

typecheck (all) ; `pnpm test` + `pnpm --filter @switchboard/core test` + `--filter @switchboard/db test`

- `--filter api test` ; lint ; format:check ; arch:check ; `CI=1 npx tsx scripts/local-verify-fast.ts` ;
  `pnpm --filter @switchboard/core build && --filter @switchboard/db build` (dist refresh). No schema change
  (rank11 dropped) => `pnpm db:check-drift` NOT required; confirm `git diff` includes no prisma/ change.
  No new env var / mutating route => verify-fast should be clean but RUN it. Independent fresh-context review
  (diff + criteria + lessons only). Then SURFACE the PR.

## CONVERGE

Re-fetch origin/main; re-check #782 + worktrees + `git diff origin/main...HEAD` clean-applies. Open PR
`fix(core): proof-chain integrity — stamp approvalId + no_show receipt demote + single cohort assembly (A7)`.
SURFACE to human for merge (merge-stop: work-trace update path + receipt-proof).
