# Ledger: the receipted-booking object (design)

Status: design spec (captured 2026-06-14). Defines the core data object for the **Ledger** agent.
Related: `docs/superpowers/specs/2026-06-14-revenue-proof-medspa-direction.md` (#1052, the direction),
`project_revenue_proof_direction` (memory), `project_show_rate_recovery` (memory),
`project_receipted_bookings_architecture` (memory).

## Why this object, and why now

The direction spec (#1052) names a single moat: the **receipted-booking object**, a per-booking proof record
spanning source, consent, trace, booking, attendance, and payment evidence, with attribution confidence and
exceptions attached. Its mental model is a financial-event ledger (Stripe payment records plus an append-only event
log), not a CRM note.

That object does not exist in code. The proof spine that feeds it is already shipped: attendance recording (#1041),
held-rate read (#1042), consent-completeness read (#1044), staff check-in UI (#1050), and the calendar
booked->held promotion (#1054). The data the object reconciles already exists, scattered across `Booking`,
`Contact`, `Opportunity`, `WorkTrace`, `Receipt`, and `ConsentRecord`. What is missing is the object that
**gathers, freezes, scores, and counts** that evidence per booking.

A first attempt put `exceptions[]` on the existing per-proof `Receipt` (PR #1057, closed). That was the wrong home:
`Receipt` is a per-PROOF primitive (one row per calendar or payment proof), whereas `exceptions[]`,
`attribution_confidence`, and `source_evidence[]` are properties of the per-RECONCILIATION object. This spec defines
that reconciliation object so those fields land in the right place.

## Scope

This spec defines the **object** (data model, lifecycle, and read), with an explicit **Ledger-lite** MVP boundary.
It does not spec the Ledger agent's conversational surface, Casey/Robin/Quinn-lite, or the system-of-record adapter
layer. Those are separate specs. The object is the prerequisite all of them consume.

## North-star tie-in

North star: **weekly receipted bookings** = the count of bookings in a week that have a complete-enough proof chain.
Two counting principles this object must honor:

1. **Unattributed is not uncounted.** A booking with valid consent, trace, and booking evidence but weak source
   data still counts; it is marked `unattributed` or low-confidence, never hidden. So the object is created for
   every booking, and attribution weakness is a field value plus an exception, not a reason to omit the row.
2. **Held rate matures.** Held appointment rate is read over receipted bookings that have passed their appointment
   date, not over all rows. The object stores `startsAt` (via the booking) so the read can apply the matured cohort.

## The object: `ReceiptedBooking`

A new stored Prisma model, one row per booking, org-scoped, written by a single Ledger reconciler. It references
the existing primitives rather than copying their mutable contents; it freezes the few values that must be stable
for audit (source evidence, expected value, attribution confidence, exceptions) at reconcile time. No patient PII
lives on the object (minimum-necessary): identity is a pseudonymous `contactKey`, not name or phone.

| Field                   | Type        | Origin                                                              | Kind             |
| ----------------------- | ----------- | ------------------------------------------------------------------ | ---------------- |
| `id`                    | String @id  | new (uuid)                                                         | stored           |
| `organizationId`        | String      | `Booking.organizationId`                                          | stored (scope)   |
| `bookingId`             | String      | `Booking.id`                                                      | ref, `@@unique([organizationId, bookingId])` (1:1) |
| `contactKey`            | String      | `Booking.contactId` (pseudonymous; never name/phone)             | ref / frozen     |
| `sourceEvidence`        | Json        | `Contact.source` + `sourceType` + `attribution` + `leadgenId`; `Booking.sourceChannel` + `connectionId` | frozen at reconcile |
| `consentId`             | String?     | matched `ConsentRecord.id`, else null (-> `missing_consent`)      | ref              |
| `traceId`               | String?     | `Booking.workTraceId` -> `WorkTrace.traceId`                     | ref              |
| `policyCheckId`         | String?     | `WorkTrace.matchedPolicies` / governance row (Ledger v1)         | ref (deferred)   |
| `humanApprovalId`       | String?     | `WorkTrace.approvalId` (Ledger v1)                               | ref (deferred)   |
| `expectedValueCents`    | Int?        | `Opportunity.estimatedValue`                                     | frozen           |
| `attendanceState`       | String      | derived from `Booking.status` + `Booking.attendance` + `Booking.rescheduledAt` + `Receipt.status` | computed / frozen |
| `proofReceiptIds`       | String[]    | `Receipt` rows where `bookingId` matches                         | ref              |
| `attributionConfidence` | String      | computed from `sourceEvidence`                                  | computed         |
| `exceptions`            | String[]    | computed at reconcile                                            | computed         |
| `reconciledAt`          | DateTime    | reconcile time                                                  | stored           |
| `reconciliationVersion` | Int         | bumped each reconcile (monotonic)                               | stored           |
| `createdAt`             | DateTime    | first reconcile                                                | stored           |

`attendanceState` enum (the #1052 vocabulary, derived): `confirmed | held | cancelled | no_show | rescheduled`.
Derivation: `Booking.attendance === "no_show"` -> `no_show`; a held `Receipt` (post booked->held promotion, #1054)
-> `held`; `Booking.status === "cancelled"` -> `cancelled`; `Booking.rescheduleCount > 0` and not yet attended ->
`rescheduled`; `Booking.status === "confirmed"` -> `confirmed`. Single source of derivation in the reconciler so
the rollup is consistent.

`attributionConfidence` ladder: `deterministic | high | medium | low | unattributed`. Ledger-lite computes only the
endpoints: `deterministic` when a hard source id is present (`Contact.leadgenId`, a CTWA/`connectionId` campaign
ref, or a UTM in `attribution`); otherwise `unattributed`. The graded middle (high/medium/low fuzzy matching) is
Ledger v1.

`exceptions` reasons: `missing_source | missing_consent | manual_override | duplicate_risk`. Computed at reconcile:
no resolvable source -> `missing_source`; no live (granted, not revoked) consent -> `missing_consent`; a staff
override on the booking -> `manual_override` (Ledger v1, needs the override signal); a duplicate-contact heuristic
hit -> `duplicate_risk` (Ledger v1). Ledger-lite wires `missing_source` and `missing_consent`, which have data
today; the other two are vocabulary until their producers exist.

## Relationship to existing primitives (it aggregates, it does not replace)

- `Receipt` stays exactly as is: the per-proof primitive (calendar | payment). `ReceiptedBooking.proofReceiptIds`
  references the `Receipt` rows for the booking. One receipted booking aggregates zero or more proof receipts.
- `WorkTrace` stays the canonical append-only execution log. `ReceiptedBooking.traceId` points into it; the object
  does NOT build a second event log. The governed source actions (booking, attendance) are already WorkTrace'd, so
  the audit trail is reachable from the object via `traceId` without duplication.
- `Booking` stays the system-of-record for the appointment. `ReceiptedBooking` is 1:1 with `Booking` and derived
  from it; it never overrides booking state.
- `ConsentRecord` / `Contact` consent fields stay Casey's domain. The object only references the consent id it
  reconciled against and records `missing_consent` when none is live.

## Lifecycle: reconcile-on-event, single writer

The reconciler is a core service with one entry point: `reconcile(orgId, bookingId)`. It reads the source
primitives, derives `attendanceState`, freezes `sourceEvidence` / `expectedValueCents`, computes
`attributionConfidence` and `exceptions`, and upserts the `ReceiptedBooking` (insert on first reconcile, update +
bump `reconciliationVersion` thereafter). It is idempotent and org-scoped, and it is the ONLY writer of the table.

It is triggered after the already-governed source mutations commit:

- booking confirmed (a `ReceiptedBooking` shell is created),
- attendance recorded (`booking.record_attendance`, #1041) -> re-reconcile (the highest-value trigger; it is where
  `attendanceState` and held-rate move),
- a payment `Receipt` minted -> re-reconcile (links payment proof).

**Architectural decision: the reconciler is a derived projection, not a new ingress mutation.** The core invariant
"mutating actions enter through `PlatformIngress.submit()`; no mutating bypass paths" targets external, operator- or
agent-initiated mutations that must pass governance. `ReceiptedBooking` is a system materialization of state that
was ALREADY governed at its source (the booking and attendance actions went through ingress and are WorkTrace'd).
It has no external mutation surface: no route, no operator intent, only the reconciler writes it, only in response
to committed source changes. This mirrors the existing report cache (`prisma-report-cache-store`), a projection
written outside ingress. `reconciledAt` + `reconciliationVersion` give per-row audit; a first-class governed
`ledger.reconcile` intent (its own WorkTrace per reconciliation) is a deliberate Ledger v1 option, not required for
the projection to be doctrine-clean.

Trigger mechanism for Ledger-lite: call the reconciler inline at the end of the relevant handlers (the attendance
handler already exists and is the primary one), best-effort and fail-loud-but-non-blocking (a reconcile failure must
not roll back the governed source action; it logs and the next trigger or a backfill re-reconciles). This matches
the #1054 promoter's best-effort posture. An event-driven (Inngest) reconciler is a v1 hardening.

## The read: weekly receipted bookings

The north-star count and the owner-report surface read `ReceiptedBooking` directly:

- **Weekly receipted bookings** = count of `ReceiptedBooking` rows whose booking falls in the week and whose proof
  chain is complete-enough (has booking + consent OR an explicit `missing_consent` exception + trace). Unattributed
  rows count (principle 1); the tile can break them out by `attributionConfidence`.
- This reuses the proven metric-clone pattern from held-rate (#1042) and consent-completeness (#1044): a store count
  -> a `computeX` sub-rollup -> a `ReportDataV1` field -> an owner-report tile. The object makes these reads
  trivial and stable (no live re-derivation across six tables per report).

## Architecture and layering

- `packages/db`: `model ReceiptedBooking` + migration + `PrismaReceiptedBookingStore` (`upsertByBooking`,
  `findByBooking`, `countReceiptedInWindow`). Layer 4.
- `packages/core`: the reconciler (`reconcileReceiptedBooking`) and the pure derivation helpers
  (`deriveAttendanceState`, `scoreAttribution`, `computeReceiptExceptions`). Layer 3, db-free: the reconciler takes
  structural reader interfaces (booking, contact, consent, receipts, worktrace) and a writer interface, exactly the
  injection pattern the operator-intent handlers use. Pure helpers are unit-tested in isolation.
- `apps/api`: wire the reconciler into the attendance handler (and the booking-confirm / payment-receipt paths) via
  a structural `ReceiptedBookingReconciler` dependency constructed in the bootstrap block. No new route for
  Ledger-lite (projection, not a mutation surface).
- the read: `countReceiptedInWindow` on the report stores -> `computeReceiptedBookings` sub-rollup ->
  `ReceiptedBookingsData` on `ReportDataV1` -> a `ReceiptedBookingsTile`.

## Ledger-lite MVP boundary

Ships now (the object exists, is populated from real data, and is read):

1. **L1 model + store.** `ReceiptedBooking` model + migration (a `String[] @default([])` scalar list for
   `exceptions` and `proofReceiptIds` follows the `TEXT[] DEFAULT ARRAY[]::TEXT[]` convention, NO `NOT NULL` for
   scalar lists; `sourceEvidence` is `Json`) + `PrismaReceiptedBookingStore`.
2. **L2 reconciler + pure helpers.** `reconcile(orgId, bookingId)` + `deriveAttendanceState` + `scoreAttribution`
   (deterministic/unattributed only) + `computeReceiptExceptions` (`missing_source`, `missing_consent`). Fully
   unit-tested against fixtures; idempotent; version bump.
3. **L3 triggers.** Invoke the reconciler from the attendance handler (and booking-confirm + payment-receipt
   paths), best-effort, non-blocking, logged.
4. **L4 read + tile.** `countReceiptedInWindow` -> `computeReceiptedBookings` -> `ReportDataV1.receiptedBookings`
   -> owner-report tile, breaking out attributed vs unattributed.

Deferred to **Ledger v1** (explicitly not now): the graded confidence ladder (high/medium/low fuzzy source
matching); cross-channel `source_evidence` reconciliation; `manual_override` and `duplicate_risk` producers;
`policy_check_id` / `human_approval_id` wiring (Quinn-lite); deep payment-event reconciliation; an event-driven
(Inngest) reconciler; a first-class governed `ledger.reconcile` intent with its own WorkTrace; a backfill job for
historical bookings.

## Compliance and jurisdiction

#1052 frames US/HIPAA sensitivity; the current code is SG/MY PDPA-first (`Booking.timezone` defaults
`Asia/Singapore`; `Contact.pdpaJurisdiction`). The object is deliberately jurisdiction- and SOR-agnostic: it
references a `bookingId` regardless of whether the booking originated in our no-PMS WhatsApp flow or a future PMS
adapter, and it stores no PII (pseudonymous `contactKey` only, evidence as ids). The compliance posture (PDPA today,
HIPAA-ready) is Casey/org-config, not baked into this object. This keeps the moat object correct for both the
shipped SG/MY wedge and the #1052 US direction.

## Testing strategy

- Pure helpers (`deriveAttendanceState`, `scoreAttribution`, `computeReceiptExceptions`): table-driven unit tests
  over the real derivation matrix (every booking/attendance/receipt combination -> expected state; each source/
  consent presence combination -> expected confidence + exceptions). These are the correctness core.
- Reconciler: tested against structural in-memory readers/writer; asserts idempotency (second reconcile bumps
  version, does not duplicate), org-scoping, and the frozen-vs-live distinction (a later source mutation does not
  silently change a frozen field without a re-reconcile).
- Store: mocked-Prisma db tests (CI has no Postgres) mirroring the existing store tests; `db:check-drift` for the
  migration.
- Read: the metric-clone fan-out (every `ReportDataV1` builder + fixture updated), proven in #1042/#1044.

## Non-goals (YAGNI)

- No second append-only event log (WorkTrace via `traceId` already is one).
- No PII on the object.
- No new mutation route or operator intent for Ledger-lite (projection only).
- No fuzzy attribution, no Quinn-lite wiring, no PMS adapter in this object.
- No change to `Receipt`, `Booking`, `WorkTrace`, or `ConsentRecord` shapes (the object references them).

## Open questions (resolve at plan time, non-blocking)

- Exact `attendanceState` precedence when signals disagree (e.g. attended but the calendar receipt never promoted):
  the reconciler picks one deterministic precedence; the table-driven tests pin it.
- Whether `contactKey` is `Contact.id` directly or a per-org salted hash of it (privacy hardening). Ledger-lite uses
  `Contact.id`; a salted key is a cheap v1 upgrade.
- Whether L3 also reconciles on booking-confirm or only on attendance for the very first cut (attendance is the
  highest-value trigger; booking-confirm can be folded in if the shell-on-create matters for the weekly count
  before attendance).
