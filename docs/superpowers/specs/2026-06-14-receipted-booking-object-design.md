# Receipted-booking object (Ledger's core) — design spec

Status: design spec (2026-06-14, rev2 after a 4-lens review). Consumes the direction spec
`docs/superpowers/specs/2026-06-14-revenue-proof-medspa-direction.md`.
Scope owner: the future Ledger agent. This spec defines the DATA MOAT only.

## Problem

The revenue-proof direction's north star is weekly receipted bookings, anchored on a
receipted-booking object: a per-booking reconciliation aggregate carrying source, consent,
trace, attendance, payment, an attribution-confidence score, and an exceptions list. Today
Switchboard has only a per-PROOF primitive (`Receipt`, kind calendar | payment). The
reconciliation aggregate does not exist, so `attribution_confidence`, `exceptions[]`, and
`source_evidence[]` have nowhere to live and the weekly count cannot be computed with proof.

## Ground truth (verified on main, 2026-06-14)

Of the 13 thesis fields, the existing primitives already cover most via foreign keys:

| Field                    | Source primitive                                                                 | Status                          |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------- |
| `receipt_id`             | `Receipt.id` (the proof primitive) by join                                       | exists; NOT this aggregate's id |
| `booking_id`             | `Booking.id`                                                                     | clean FK                        |
| `contact_key`            | `Contact.id` (pseudonymous)                                                      | clean FK (`Booking.contactId`)  |
| `trace_id`               | `WorkTrace.traceId` via `Booking.workTraceId`                                    | clean FK                        |
| `attendance_state`       | `Booking.attendance` (null \| attended \| no_show)                               | clean                           |
| `payment_event_ids[]`    | `LifecycleRevenueEvent` by `bookingId`                                           | clean FK                        |
| `expected_value`         | `Opportunity.estimatedValue` (via `Booking.opportunityId`)                       | partial (join)                  |
| `consent_id`             | `Contact` PDPA fields (`consentGrantedAt`/`consentRevokedAt`/`pdpaJurisdiction`) | clean (on Contact)              |
| `source_evidence[]`      | `ConversionRecord` (by `bookingId`) + `Contact.source/sourceType/attribution`    | clean FK + partial              |
| `policy_check_id`        | `WorkTrace.matchedPolicies`                                                      | partial (embedded)              |
| `human_approval_id`      | `WorkTrace.approvalId` / `ApprovalRecord`                                        | partial                         |
| `attribution_confidence` | none                                                                             | MISSING (derived judgment)      |
| `exceptions[]`           | none                                                                             | MISSING (derived judgment)      |

Only `attribution_confidence` and `exceptions[]` are genuinely missing: derived judgments not
present in any source primitive, not losslessly recomputable (scoring evolves; manual overrides are
human input). Everything else has a home and is recomputable by join.

Review correction: `consent_id` is the `Contact` PDPA fields, NOT the `ConsentRecord` model.
`ConsentRecord` is the creative-pipeline UGC release registry (keyed `orgId`, no contact/booking
link, cross-tenant-unsafe to join here). `source_evidence[]` is less scattered than first thought:
`ConversionRecord` carries `bookingId` + `sourceAdId`/`sourceCampaignId`/`sourceChannel` as a clean
per-booking FK and is the attribution fact store; do not migrate those columns onto this aggregate.

## Decisions (locked)

1. **Hybrid persistence.** A thin persisted `ReceiptedBooking` row holds ONLY the derived and
   snapshot fields (`attributionConfidence`, `exceptions[]`, `expectedValueAtIssue`, override
   provenance) plus FK references. Live fields (attendance, payment, consent, trace, current source
   evidence) are read through joins. No duplication of facts that already have a home.
2. **Identity.** `ReceiptedBooking.id` is this aggregate's own id. It is NOT the thesis `receipt_id`
   — that resolves to the linked `Receipt` row(s) by join. `Receipt` stays the proof primitive; this
   aggregate sits above it.
3. **Read-model, not canonical (Doctrine §3).** `ReceiptedBooking` is a derived read-model and
   judgment anchor; it is not operational truth and records no action-lifecycle state. `WorkTrace`
   remains the canonical record. It is not a parallel persistence/control plane.
4. **Revenue counting.** Weekly receipted-bookings revenue counts `expectedValueAtIssue` (the stable
   per-cohort snapshot); the live `Opportunity.estimatedValue` is exposed only as a drift indicator.
   A booking with no `opportunityId` has a null snapshot: it counts toward the booking COUNT, and is
   excluded from the revenue SUM.

## Persisted model: `ReceiptedBooking` (shipped, slice 1)

One row per booking (`bookingId @unique`). Stores derived + snapshot fields only.

```
model ReceiptedBooking {
  id                    String    @id @default(uuid())   // this aggregate's own id (NOT receipt_id)
  organizationId        String
  bookingId             String    @unique                // FK -> Booking.id (bare string, like Receipt)
  issuedAt              DateTime  @default(now())          // weekly cohort key
  attributionConfidence String                            // enum below; derived
  attributionUpdatedAt  DateTime
  expectedValueAtIssue  Int?                              // cents, snapshot of Opportunity.estimatedValue
  currency              String?                           // org default at issuance
  exceptions            Json                              // ExceptionEntry[]
  overriddenBy          String?
  overrideReason        String?
  overriddenAt          DateTime?
  lastEvaluatedAt       DateTime
  createdAt             DateTime  @default(now())

  @@index([organizationId, issuedAt])
  @@index([organizationId, attributionConfidence])
}
```

## Schemas (`@switchboard/schemas`)

```
AttributionConfidence = "deterministic" | "high" | "medium" | "low" | "unattributed"
ExceptionCode = "missing_source" | "missing_consent" | "manual_override" | "duplicate_contact_risk"
ExceptionEntry = { code; detail?; raisedAt: Date; resolvedAt?: Date | null }
ReceiptedBooking = persisted fields, exceptions: ExceptionEntry[]
ReceiptedBookingView = the full assembled object (persisted + joined live fields). This type MUST
  live in @switchboard/schemas (it crosses into apps), not as a db-local interface.
```

`expectedValueAtIssue` is cents (Int), nonnegative.

## Attribution-confidence ladder (pure function, `core/receipts`)

Deterministic enum mapping over existing source fields (no numeric thresholds, so no NaN-blind gate).
Pure `scoreAttribution(evidence)` reused everywhere a booking is labelled:

- **deterministic**: a hard click/lead id ties the booking to one ad/campaign (`Contact.leadgenId`,
  or `ConversionRecord.sourceAdId` matched, or a CTWA click id).
- **high**: first-party source with a campaign id, no single deterministic click (`sourceType` in
  {ctwa, instant_form} with `sourceCampaignId`).
- **medium**: a campaign id or channel is known, but not a first-party click (`sourceCampaignId`
  without a first-party `sourceType`, or a bare `sourceChannel`).
- **low**: only a coarse `sourceType` (e.g. organic / web / self-reported), no campaign or channel.
- **unattributed**: no usable source evidence. Still counted; raises `missing_source`.

## Exceptions taxonomy (pure function, `core/receipts`)

`evaluateExceptions(context) -> ExceptionEntry[]`:

- **missing_source**: attribution resolved to `unattributed`.
- **missing_consent**: `Contact.consentGrantedAt` absent or `consentRevokedAt` set (channel-scoped
  per `messagingOptIn` for WhatsApp). Reads Contact PDPA fields, never `ConsentRecord`.
- **manual_override**: a human overrode attribution/status (set alongside `overriddenBy`).
- **duplicate_contact_risk**: the contact matches another by phone/email (identity ambiguity).

## Read-projection: `ReceiptedBookingView`

`PrismaReceiptedBookingStore.getView(orgId, bookingId)` and `listForCohort(orgId, fromIssuedAt,
toIssuedAt)` in db (db owns the Prisma joins; core stays store-free). The view resolves `receipts`
(Receipt by bookingId, including the proof `receipt_id`), `contact_key` + `consent_id` + live
`source_evidence[]` (Contact + ConversionRecord), `trace_id` + `policy_check_id` +
`human_approval_id` (WorkTrace), `attendance_state` (Booking), `payment_event_ids[]`
(LifecycleRevenueEvent), and live `expected_value` (Opportunity, alongside the snapshot).

EVERY join leg WHERE must carry `organizationId` (the F12 read-side IDOR lesson) — not only the
Booking read but the ConversionRecord / WorkTrace / LifecycleRevenueEvent legs too. Null-guard the
Booking join: an orphaned aggregate row (booking hard-deleted) is filtered, not surfaced.

## Layering

schemas (types + enums + the View type) -> core/receipts (pure `scoreAttribution` +
`evaluateExceptions`, like `is-paid-visit`) -> db (`PrismaReceiptedBookingStore` + the read joins).
No core -> db import; scoring functions are pure and store-free.

## Implementation slices (re-sequenced after review)

The review flagged that persisting derived fields via an issuance hook + re-eval triggers BEFORE any
consumer exists is "data with no consumer". So we ship the pure logic and the read path (which serve
the north-star count immediately), and DEFER the persisted write-path until a consumer needs it.

1. **DONE** — `ReceiptedBooking` model + migration + `@switchboard/schemas` types/enums (PR #1062).
2. **Scoring functions**: pure `scoreAttribution` + `evaluateExceptions` in `core/receipts` with
   exhaustive enum tests (one per ladder rung + each exception code). Cheap, pure, reusable, no
   drift risk.
3. **Weekly count + owner-report read (the north-star mover)**: a `countReceiptedBookings(orgId,
window)` read + a `receiptedBookings` field on `ReportDataV1` + an owner-report tile, mirroring
   the shipped `computeHeldRate` / `computeConsentCompleteness` reads. Assembled lazily over existing
   FKs (Booking + Receipt + Contact + ConversionRecord), labelling each via the slice-2 functions.
   No dependency on the persisted write-path. This is the cheapest slice that moves the metric.
4. **Read-projection**: `PrismaReceiptedBookingStore.getView` + `listForCohort`, org-scoped per leg,
   computing confidence/exceptions lazily via the slice-2 functions (not reading a persisted copy),
   with a producer->consumer safeParse seam test.

DEFERRED until a real consumer (the Ledger agent / weekly UI / an override workflow) exists:

> STATUS (2026-06-15, after #1080): the issuance hook below SHIPPED in #1080; the re-evaluation
> triggers item is RESOLVED as not-needed for the recomputable signals. See "Re-evaluation triggers:
> resolution (2026-06-15)" at the end of this section.

- **Issuance hook**: issue/refresh a `ReceiptedBooking` row. When built, it MUST be wired inside the
  governed `calendar-book` tool seam (`packages/core/src/skill-runtime/tools/calendar-book.ts`, the
  only non-test caller of `bookingStore.create`, reached only through PlatformIngress), in the SAME
  `$transaction` as the booking + receipt mint, idempotent via findFirst-by-`bookingId`-before-create
  (mirroring the receipt-mint P2002 avoidance). NEVER at the db store (would bypass governance) and
  NEVER as a post-submit write (would orphan / be ingress-less).
- **Re-evaluation triggers** (attendance / payment / consent / override). When built: `exceptions`
  re-eval merges against the prior array (key open entries by `code`; newly-absent codes get
  `resolvedAt` stamped; newly-present codes with no open entry get a new `raisedAt`; existing open
  entries untouched) — never overwrite, to preserve history and avoid double-add. `attributionConfidence`
  is a single mutable value (audit via `attributionUpdatedAt` + WorkTrace); confidence MAY drop on
  re-eval (e.g. after a contact merge). A manual override MUST route through a WorkTrace-writing
  governed path, with the override columns as the resulting snapshot.

## Re-evaluation triggers: resolution (2026-06-15)

After #1080 shipped the issuance hook, the re-evaluation-triggers item was re-examined against what
actually shipped. Conclusion: it is NOT needed for the recomputable signals (attendance, consent,
source evidence), because the owner tiles never consume a frozen copy of the derived fields.

- `PrismaReceiptedBookingStore.getView` reads only the SNAPSHOT + override-provenance columns from the
  persisted row (`issuedAt`, `expectedValueAtIssue`, `currency`, `overriddenBy`, `overrideReason`,
  `overriddenAt`). It recomputes `attributionConfidence` and `exceptions` LAZILY on every read, via the
  pure `scoreAttribution` / `evaluateExceptions` functions, from live Contact + ConversionRecord +
  consent facts.
- Both owner rollups (`computeReceiptedBookingQuality`, `computeReceiptedBookingRevenue`) consume that
  lazy `listForCohort` projection. Quality reads the always-fresh derived fields; revenue reads the
  frozen `expectedValueAtIssue` snapshot (snapshot-if-present-else-live).

Three consequences close the recomputable-signal triggers:

1. **Attendance is not an input** to `scoreAttribution` or `evaluateExceptions`, and `getView` already
   surfaces `attendanceState` as a live join. An attendance trigger would re-score nothing.
2. **Consent and source evidence are recomputed live** on every read, so a consent or attribution
   trigger is redundant with the lazy path.
3. **Re-scoring the persisted derived columns would corrupt their meaning.** The persisted
   `attributionConfidence` (with `attributionUpdatedAt`) is the ISSUANCE-TIME judgment, an audit
   anchor, deliberately write-only on the read path. Mutating it in place would conflate "what we
   judged at issuance" with "what we judge now," for no consumer benefit, since the live value is
   already available lazily via `getView`.

What remains genuinely missing is the two NON-recomputable signals, which the lazy path cannot derive
and `getView` currently hardcodes off (`overriddenBy: null`, `duplicateContactRisk: false`):

- `manual_override`: a human overriding attribution or status. No source fact to recompute from.
- `duplicate_contact_risk`: an identity-ambiguity match between contacts.

Each needs a NEW governed producer (a manual-override action through `PlatformIngress` writing a
`WorkTrace`; an identity matcher) PLUS the matching `getView` consumer fix (translate the persisted
override or identity signal into the returned `exceptions` and attribution). That is a new operator
product surface that touches the governance and ingress seam, not a derived-read-model tweak, so it is
scheduled as its own slice when the capability is wanted. When built, the `exceptions` merge stays
append-only (key open entries by `code`; stamp `resolvedAt` on newly-absent codes; add a new `raisedAt`
for newly-present codes; leave existing open entries untouched), and the override routes through the
WorkTrace-writing governed path with the override columns as the resulting snapshot. Payment re-eval
stays out of scope (comped pilot, Stripe off).

## Out of scope

The Ledger agent, the weekly report UI beyond the slice-3 read/tile, Robin (recovery/show-rate) and
the other new agents (Casey, Quinn-lite), and a full append-only per-receipt event log (WorkTrace
already provides the action audit).
