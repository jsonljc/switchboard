# Receipted-booking object (Ledger's core) — design spec

Status: design spec (2026-06-14). Consumes the direction spec
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

Of the 13 thesis fields, the existing primitives already cover most via clean foreign keys:

| Field                               | Source primitive                                             | Status                                |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `receipt_id` (this object's own id) | new table                                                    | new                                   |
| `booking_id`                        | `Booking.id`                                                 | clean FK                              |
| `contact_key`                       | `Contact.id` (pseudonymous)                                  | clean FK (`Booking.contactId`)        |
| `trace_id`                          | `WorkTrace.traceId` via `Booking.workTraceId`                | clean FK                              |
| `attendance_state`                  | `Booking.attendance` (null \| attended \| no_show)           | clean                                 |
| `payment_event_ids[]`               | `LifecycleRevenueEvent` by `bookingId`                       | clean FK                              |
| `expected_value`                    | `Opportunity.estimatedValue` (via `Booking.opportunityId`)   | partial (join)                        |
| `consent_id`                        | `Contact` PDPA fields / `ConsentRecord`                      | partial (not FK'd to booking)         |
| `source_evidence[]`                 | `Contact.source/sourceType/attribution` + `ConversionRecord` | partial (scattered)                   |
| `policy_check_id`                   | `WorkTrace.matchedPolicies`                                  | partial (embedded, not indexed)       |
| `human_approval_id`                 | `WorkTrace.approvalId` / `ApprovalRecord`                    | partial (not joinable from a receipt) |
| `attribution_confidence`            | none                                                         | MISSING (derived judgment)            |
| `exceptions[]`                      | none                                                         | MISSING (derived judgment)            |

The three missing fields are derived judgments, not facts in any source primitive. They cannot be
recomputed losslessly (attribution scoring evolves; manual overrides are human input), so they need
a durable home.

## Decisions (locked)

1. **Hybrid persistence.** A thin persisted `ReceiptedBooking` row holds ONLY the derived and
   snapshot fields plus foreign-key references. The live fields (attendance, payment, consent, trace,
   current source evidence) are read through joins at query time. No duplication of facts that already
   have a home; a durable audit anchor for the judgments and for what was counted.
2. **Issuance at booking creation, refined on events.** A row is issued the moment a booking is
   created, seeding the derived fields from what is known then. It is re-evaluated as attendance,
   payment, consent, and override events arrive. Guarantees every booking is countable and flagged
   (matching "unattributed is not uncounted"), and gives a stable `issuedAt` for weekly cohorting.
3. **Sits above `Receipt`, does not replace it.** `Receipt` stays the proof primitive. The projection
   resolves a booking's receipts by join. `ReceiptedBooking.id` is the thesis `receipt_id` (the
   proof-object id).

## Persisted model: `ReceiptedBooking` (new Prisma model)

One row per booking (`bookingId` unique). Stores derived + snapshot fields only.

```
model ReceiptedBooking {
  id                     String   @id @default(uuid())   // = thesis receipt_id
  organizationId         String
  bookingId              String   @unique                // FK -> Booking.id
  issuedAt               DateTime @default(now())         // weekly cohort key
  attributionConfidence  String                           // enum below; derived
  attributionUpdatedAt   DateTime
  expectedValueAtIssue   Int?                             // cents, snapshot of Opportunity.estimatedValue
  currency               String?                          // snapshot
  exceptions             Json                             // ExceptionEntry[] (below); derived
  overriddenBy           String?                          // set when a human overrides attribution/exception
  overrideReason         String?
  overriddenAt           DateTime?
  lastEvaluatedAt        DateTime
  createdAt              DateTime @default(now())

  @@index([organizationId, issuedAt])
  @@index([organizationId, attributionConfidence])
}
```

Migration is hand-written (mirror the Booking/Receipt migration conventions; no in-schema partial
unique is needed here). `bookingId @unique` makes issuance idempotent.

## Schemas (`@switchboard/schemas`)

```
AttributionConfidence = "deterministic" | "high" | "medium" | "low" | "unattributed"
ExceptionCode = "missing_source" | "missing_consent" | "manual_override" | "duplicate_contact_risk"
ExceptionEntry = { code: ExceptionCode; detail?: string; raisedAt: Date; resolvedAt?: Date | null }
ReceiptedBooking = { ...persisted fields, exceptions: ExceptionEntry[] }
ReceiptedBookingView = the full assembled object (persisted + joined live fields)
```

`expectedValueAtIssue` is cents (Int), never dollars (the receipted-bookings note records the dollars
vs cents trap). Validate with the positive-safe-cents pattern already used for receipts.

## Attribution-confidence ladder (pure function, `core/receipts`)

A deterministic mapping over existing source fields. Enum mapping, no numeric thresholds (so no
NaN-blind comparison gate). Defined as a pure function `scoreAttribution(evidence)` reused at
issuance and re-evaluation:

- **deterministic**: a hard click/lead identifier ties the booking to one ad/campaign
  (`Contact.leadgenId` present, or `ConversionRecord.sourceAdId` matched, or a CTWA click id).
- **high**: strong first-party source with a campaign id but no single deterministic click
  (`sourceType` in {ctwa, instant_form} with `sourceCampaignId`).
- **medium**: channel known, no campaign/ad id (`sourceChannel` or `sourceType` present only).
- **low**: coarse self-reported or organic source.
- **unattributed**: no usable source evidence. Still counted; raises a `missing_source` exception.

## Exceptions taxonomy (pure function, `core/receipts`)

`evaluateExceptions(context) -> ExceptionEntry[]`, reused at issuance and re-eval:

- **missing_source**: attribution resolved to `unattributed`.
- **missing_consent**: no valid channel-scoped, non-revoked consent for the contact.
- **manual_override**: a human overrode attribution or status (set alongside `overriddenBy`).
- **duplicate_contact_risk**: the contact matches another by phone/email (identity ambiguity).

Exceptions are resolved by stamping `resolvedAt`, not by deletion (keeps the "why was this flagged"
trail). v1 stores the current exception set on the row; the full append-only action audit already
lives in `WorkTrace`, so a per-receipt event log is deferred (YAGNI) and noted as a future option.

## Read-projection: `ReceiptedBookingView`

A db-level read store assembles the full object by joining the persisted row with live primitives
(it is a read that spans several Prisma tables, so it belongs in db, not core):

`PrismaReceiptedBookingStore.getView(orgId, bookingId)` and `listForCohort(orgId, fromIssuedAt,
toIssuedAt)`. The view resolves: `receipts` (Receipt by bookingId), `contact_key` + `consent_id` +
live `source_evidence[]` (Contact + ConversionRecord), `trace_id` + `policy_check_id` +
`human_approval_id` (WorkTrace), `attendance_state` (Booking), `payment_event_ids[]`
(LifecycleRevenueEvent), and current `expected_value` (Opportunity, alongside the snapshot for audit).
All reads are org-scoped (IDOR-safe, per the F12 read-side lesson).

## Layering

schemas (types + enums) -> core/receipts (pure `scoreAttribution` + `evaluateExceptions`, like
`is-paid-visit`) -> db (`PrismaReceiptedBookingStore` + migration; assembles the view). The issuance
hook is wired at the booking-create path (app/core seam) in a later slice. No core -> db import; the
scoring functions are pure and store-free.

## Implementation slices (each its own PR, consumes this spec)

1. **Schema + model + migration**: `ReceiptedBooking` Prisma model + hand-written migration +
   `@switchboard/schemas` types/enums. Co-located tests; `db:check-drift`. (Touches `prisma/` =>
   surface before merge.)
2. **Scoring functions**: pure `scoreAttribution` + `evaluateExceptions` in `core/receipts` with
   exhaustive enum tests (one per ladder rung + each exception code).
3. **Issuance hook**: issue a `ReceiptedBooking` at booking creation (idempotent on `bookingId`),
   seeding derived fields. Wired at the booking-create seam.
4. **Read-projection**: `PrismaReceiptedBookingStore.getView` + `listForCohort`, org-scoped, with
   the join assembly and a producer->consumer safeParse seam test.
5. **Re-evaluation triggers**: recompute derived fields on attendance / payment / consent / override
   events (booked->held already ships; this adds the attribution/exception refresh).

Deferred to their own specs: the Ledger agent, the weekly receipted-bookings report/UI, and the
Robin / recovery workstream.

## Out of scope

- The Ledger agent itself (operates this object; separate spec).
- The weekly report and owner-facing UI.
- Robin (recovery/show-rate) and the other new agents (Casey, Quinn-lite).
- A full append-only per-receipt event log (WorkTrace already provides the action audit).
