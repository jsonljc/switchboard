# receipted-booking object (Ledger) spec loop — externalized state (scratch, not committed)

Durable record: [[project_revenue_proof_direction]] + [[project_show_rate_recovery]] + [[project_receipted_bookings_architecture]].

Goal: spec the receipted-booking RECONCILIATION object (Ledger's core) as a focused docs PR on main, so the parked field slices (exceptions[]/attribution_confidence/source_evidence[]) and the new agents become viable. Thesis fields live in spec #1052 (docs/superpowers/specs/2026-06-14-revenue-proof-medspa-direction.md).
Authority: autonomous-with-guardrails for the SPEC PR (docs-only, low risk); but DESIGN FORKS go to the user (greenfield + moat-defining).
Task-size: standard (one focused docs/superpowers PR). NOT code.
Base: origin/main @ 618ee498 (re-fetch before PR).

## Why spec-first (ORIENT finding from prior slice)

Existing `Receipt` (Prisma model, schema.prisma:2124) is a per-PROOF primitive (calendar|payment). The thesis's receipted-booking object is a per-reconciliation AGGREGATE (receipt_id, source_evidence[], consent_id, trace_id, policy_check_id, attribution_confidence, exceptions[], attendance/payment state). It does not exist. Must decide where it lives + persisted-model vs computed-projection before any field slice.

## Steps

| step             | done-condition                                                                                                                 | status                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| ORIENT           | compact map of existing primitives the object reconciles (Receipt/Booking/Contact+consent/WorkTrace+trace/RevenueEvent/source) | in_progress (Explore dispatched) |
| FRAME/brainstorm | user locks: persisted-model vs read-projection; reconcile-on-read vs on-write; relationship to existing Receipt                | todo                             |
| PLAN+WRITE       | spec doc in docs/superpowers/specs/                                                                                            | todo                             |
| VERIFY+PR        | format/arch (docs) + focused PR to main                                                                                        | todo                             |

## Decisions LOCKED (user, 2026-06-14)

- Persistence: HYBRID (thin ReceiptedBooking table for derived/snapshot fields + FK refs; live fields via joins).
- Issuance: at booking creation, refined on events (append-only-ish; resolvedAt not delete).
- Scope: object + attribution_confidence ladder + exceptions[] taxonomy + read-projection. DEFER Ledger agent, weekly report UI, Robin/recovery, other new agents.
- User said "stop checking back, use best judgment" -> ran the rest autonomously (skipped per-section + user-review gates).

## Outcome

SPEC WRITTEN + shipped: docs/superpowers/specs/2026-06-14-receipted-booking-object-design.md, PR #1060 (auto-merge armed, BLOCKED on in-progress CI; docs-only). Defines ReceiptedBooking Prisma model, schemas types/enums, scoreAttribution + evaluateExceptions pure fns (core/receipts), PrismaReceiptedBookingStore read-projection, and 5 impl slices.

## 4-LENS REVIEW (2026-06-14) — direction CONFIRMED, re-sequenced

Reviewers: doctrine, reuse/overlap, product/YAGNI, data-model. Outcomes:

- Direction sound; hybrid persistence justified (only attribution_confidence + exceptions[] are non-recomputable).
- FIXED in spec rev2 (PR #1063, auto-merge armed) + slice-1 comments (PR #1062 updated): (a) id != receipt_id (resolves to Receipt by join) — identity collision; (b) consent = Contact PDPA fields NOT ConsentRecord (UGC registry, cross-tenant-unsafe); (c) revenue counts snapshot expectedValueAtIssue; (d) View type in schemas + org-scope EVERY join leg; (e) read-model not canonical (Doctrine 3); (f) issuance seam pinned = calendar-book tool tx, findFirst-before-create; (g) exceptions re-eval merge contract pinned.
- RE-SEQUENCED (defer data-with-no-consumer): ship pure fns + lazy weekly-count report read + read-projection; DEFER issuance hook + re-eval triggers until a consumer (Ledger agent/UI/override) exists.

## NEXT (impl slices, re-sequenced)

1. DONE (surfaced) — PR #1062 feat/receipted-booking-model (8a419754): ReceiptedBooking model + migration + schemas types + id-not-receipt_id comment fix. Gates green, drift OK, review ZERO findings. prisma/ => awaiting USER merge.
2. pure scoreAttribution + evaluateExceptions in core/receipts (enum tests). Auto-mergeable.
3. countReceiptedBookings read + ReportDataV1 field + owner-report tile (mirror computeHeldRate/computeConsentCompleteness; lazy over FKs). THE north-star mover. Auto-mergeable.
4. read-projection PrismaReceiptedBookingStore.getView/listForCohort (lazy compute via slice-2 fns; org-scope per leg; safeParse seam test). Auto-mergeable.
   DEFERRED: issuance hook (calendar-book tx, findFirst-before-create) + re-eval triggers — until a consumer exists.
5. pure scoreAttribution + evaluateExceptions in core/receipts (enum tests).
6. issuance hook at booking-create (idempotent on bookingId).
7. read-projection PrismaReceiptedBookingStore.getView/listForCohort (org-scoped; safeParse seam test).
8. re-eval triggers (attendance/payment/consent/override).

## Log

- 2026-06-14: prior slice (#1054 booked->held) closed. Started Ledger-object-spec loop. ORIENT via Explore (5/13 clean FK, 5 partial, 3 missing-derived). Brainstorm: hybrid + issue-at-creation + scope-A locked. Spec written + PR #1060, auto-merge armed. NEXT = slice 1 (schema+migration) off updated main once #1060 lands.
