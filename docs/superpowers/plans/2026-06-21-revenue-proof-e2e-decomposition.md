# Revenue-proof whole-loop e2e: decomposition plan

Date: 2026-06-21
Status: slice 1 in flight; slices 2-3 queued for the build-loop
Workstream: revenue-proof / activation (metric trust + de-risk), per `project_north_star_activation_gap` (P3 lane)

## Why

The receipted-bookings roster (Alex / Casey / Ledger-lite / Quinn-lite / Robin) is code-complete, and
the metric-trust de-risk lane has landed two seam tests:

- P3.1 (PR #1198): the ledger weekly-report cron drives REAL `PlatformIngress` + the platform-direct
  carve-out + the REAL `OperatorMutationMode` handler via the REAL submit-request producer.
- P3.2 (PR #1200/#1201): the owner report tiles drive REAL `createPeriodRollup` + the REAL
  `PrismaReceiptedBookingStore` projection, but over a **mocked, readonly** Prisma cohort fixture.

Per-feature loop tests also exist (chat-approval, recommendation-handoff cron-full-loop,
robin-recovery-approval, riley-pause-*, provision-end-to-end). What is missing: a single test that
proves the **north-star journey end-to-end through the real producers and handlers**, so cross-seam
drift across the whole loop ships silently. In particular, nothing proves that **Alex's booking WRITE
actually populates the read projection** that P3.2 only ever fed a readonly mock. That write-to-read
seam is the prize.

## The north-star journey (the loop under test)

```
lead intake -> Alex booking -> calendar Receipt mint -> ReceiptedBooking issuance
            -> attendance (Receipt booked->held) -> verified payment (paid Receipt + RevenueEvent)
            -> read projection (getView/listForCohort) -> period rollup
            -> owner revenue + quality tiles -> weekly digest -> ledger.deliver_weekly_report email
```

Tool-backed facts that shape the design:

1. **Booking is LLM-gated.** `calendar-book` is a skill-runtime tool (operation `booking.create`),
   NOT a submittable intent. There is no `booking.*` create intent. The real Receipt mint and the
   `issueReceiptedBookingInTx` issuance live inside that tool's transaction. Attendance, payment, and
   delivery, by contrast, ARE clean `operator_mutation` + `system_auto_approved` intents reachable
   through real `PlatformIngress`.
2. **CI has no Postgres**, so the whole write+read loop must share ONE mocked persistence substrate.
   No in-memory Receipt / ReceiptedBooking store exists today; the precedent for a hand-built stateful
   in-memory store is `apps/api/src/services/cron/revenue-proven-loop.test.ts` (`SharedMemoryStore`).
3. The real Prisma-backed stores (`PrismaReceiptStore`, `PrismaReceiptedBookingStore`) and the
   `calendar-book` transaction can all run against ONE in-memory Prisma fake, so "mock only Prisma (the
   external edge)" keeps every producer and handler real.

## Real-vs-mock boundary (whole loop)

REAL (under test): `PlatformIngress` + `GovernanceGate`, the operator-intent handlers (attendance,
payment, deliver-weekly-report), the `calendar-book` `booking.create` operation with its Receipt mint
and `issueReceiptedBookingInTx`, `createPeriodRollup`, the pure `compute*` rollups, the
`PrismaReceiptedBookingStore` / `PrismaReceiptStore` projections, `buildWeeklyDigest`, the delivery
service.

MOCKED (the true external edges only): the LLM (the booking tool op is invoked directly, so the
skill-executor and model are bypassed; the booking PRODUCER stays real), Google Calendar (a stub
provider returning a fixed event id), Stripe (the injected `PaymentVerifier`), WhatsApp (not exercised
on this happy path), Resend email (the injected `EmailSender`), and Prisma (a small stateful in-memory
fake).

Assertions are the FINAL owner-facing numbers (counts + revenue cents) the seeded journey must produce,
not intermediate fixtures.

## The reusable in-memory Prisma substrate

A small stateful fake (Maps per model) backing every model the loop touches: `booking`, `receipt`,
`opportunity`, `contact`, `receiptedBooking`, `conversionRecord`, `lifecycleRevenueEvent`, `workTrace`,
`outboxEvent`. It exposes:

- a prisma-shaped client consumed by `PrismaReceiptedBookingStore` and `PrismaReceiptStore`,
- the same client as the transaction object for the tool's injected `runTransaction(fn) => fn(client)`,
- thin store-subset adapters (`bookingStore` / `opportunityStore` / `contactStore`) for the
  `calendar-book` deps.

Fidelity points the substrate MUST honor (else it proves the fake, not the loop):

- `receipt.create` stamps `createdAt = data.createdAt ?? <frozen now>` (the real schema defaults it via
  `@default(now())` and `buildCalendarReceiptData` does NOT set it; the cohort window filter keys on it).
- `receipt.findMany` honors the cohort WHERE (`organizationId`, `kind`, `status in`, `createdAt` range,
  `bookingId not null`) and `distinct: ["bookingId"]`.
- `opportunity.updateMany` honors `where` (id, org, `stage notIn`) and returns `{ count }`.
- every read is org-scoped (mirrors the F12 IDOR posture the real stores enforce).

Each slice seeds DECOY rows (out-of-window, void, non-calendar, other-org) so the filters are proven to
genuinely filter and the substrate is not a rubber stamp.

The substrate ships in slice 1 (`apps/api/src/__tests__/revenue-loop-substrate.ts`) and is reused by
slices 2-3.

## Decomposition

### Slice 1 (this PR family): booking-producer -> owner tiles

Drive the REAL `calendar-book` `booking.create` op (real Receipt mint + real issuance) over the new
substrate, then read back through the REAL `PrismaReceiptedBookingStore` + `PrismaReceiptStore` ->
`createPeriodRollup` -> the owner `receiptedBookings` / `receiptedBookingRevenue` /
`receiptedBookingQuality` tiles, via the `GET /api/dashboard/reports` route (the P3.2 harness pattern).
Closes the write-to-read gap P3.2 left open; builds the reusable substrate.

Acceptance: a seeded lead+opportunity booked through the tool yields exactly one receipted booking, and
the owner tiles report `count=1`, `revenueCents=<expectedValueAtIssue>`, `confidence.deterministic=1`,
zero exceptions, `bookingsNeedingAttention=0`; decoy receipts are excluded.

### Slice 2: attendance + payment -> proven-paid revenue tile (through real PlatformIngress)

Reuse the substrate. Book (or seed a booking+calendar receipt), then submit `booking.record_attendance`
(promotes the Receipt booked->held) and `payment.record_verified` (writes a paid Receipt + RevenueEvent,
with the injected `PaymentVerifier` standing in for Stripe) through REAL `PlatformIngress`. Assert the
owner `receiptedBookingRevenue` tile now reports `paidRevenueCents` / `paidBookings`, and the held
promotion is reflected.

### Slice 3: weekly digest + delivery (through real PlatformIngress)

Reuse the substrate and the seeded cohort. Assert `buildWeeklyDigest` renders the owner-facing numbers
(receipted bookings, expected revenue, proven-paid revenue, needs-attention), then submit
`ledger.deliver_weekly_report` through REAL `PlatformIngress` with an injected `EmailSender`, asserting
the digest figures reach the email payload. (P3.1 proves the cron submit seam; slice 3 proves the
assemble-and-deliver content seam.)

A later optional capstone can chain slice 1 -> 2 -> 3 in one test once the pieces exist, and can add the
maximal-realism booking entry (Alex skill-mode through `PlatformIngress` with a stubbed LLM emitting the
tool-call) as its own slice if judged worth the harness cost.

## Risks and mitigations

- **Substrate fidelity** (the fake could give false green): mitigated by honoring the real WHERE /
  `distinct` / `createdAt` semantics, seeding decoys that the filters must exclude, and running the REAL
  production stores over the fake rather than re-implementing their logic.
- **Wall-clock flake**: time is frozen so the booked receipt's `createdAt` deterministically lands in
  the route's THIS WEEK window (computed in the default `Asia/Singapore` tz).
- **Scope creep**: each slice is one bounded PR; the substrate is the only shared new surface.

## Out of scope

The maximal-realism booking entry (skill-mode + stubbed LLM through ingress), Mira, v2 recovery, the
identity matcher, and any production-code change. Slice 1 is test-only.
