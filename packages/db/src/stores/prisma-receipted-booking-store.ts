import type { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  ReceiptedBookingView,
  AttributionConfidence,
  PdpaJurisdiction,
  ReconcileBookingParameters,
} from "@switchboard/schemas";
import {
  scoreAttribution,
  evaluateExceptions,
  assembleViewExceptions,
  mergeExceptions,
  snapshotCents,
} from "@switchboard/core";
import type { SerializedExceptionEntry } from "@switchboard/core";

/**
 * Outcome of a reconcile write. `created` (only on `applied`) distinguishes a governed LATE issuance
 * (a historical booking with no prior row, minted by override_attribution) from an in-place update.
 * `not_issued` is flag/resolve hitting a booking with no persisted row; `unsupported_code` is a
 * resolve_exception for a code outside the v1-supported set.
 */
export type ApplyReconcileResult =
  | { status: "not_found" }
  | { status: "not_issued" }
  | { status: "applied"; created: boolean }
  | { status: "unsupported_code" };

/** The only exception codes a resolve_exception action may stamp in v1 (spec Decision 2). */
const RESOLVABLE_CODES: ReadonlySet<string> = new Set(["duplicate_contact_risk"]);

/** Duck-typed Prisma unique-constraint check (mirrors PrismaWorkTraceStore; no Prisma value import). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

/**
 * Read-projection store for the receipted-booking view (Ledger's data plane, spec slice 4).
 *
 * Live fields are assembled LAZILY over existing foreign keys (Booking + Receipt + ConversionRecord +
 * Contact + LifecycleRevenueEvent + Opportunity + WorkTrace), and `attributionConfidence` /
 * `exceptions` are derived on the fly via the pure `core/receipts` functions, so those never drift
 * from the source facts. The persisted `ReceiptedBooking` issuance row (now minted in the governed
 * calendar-book transaction) is also read when present, surfacing the stable snapshot fields
 * (issuedAt / expectedValueAtIssue / currency / override provenance); it is null for historical
 * bookings created before the issuance hook, in which case only the live fields are exposed.
 *
 * Every Prisma leg is org-scoped (the F12 read-side IDOR lesson): not only the Booking read but each
 * ConversionRecord / Contact / WorkTrace / LifecycleRevenueEvent / Opportunity leg too.
 */
export class PrismaReceiptedBookingStore {
  constructor(private prisma: PrismaDbClient) {}

  /**
   * Assemble the view for one booking. Returns null when the booking is absent or belongs to another
   * org (the orphaned aggregate is filtered, never surfaced). `now` is injected for deterministic
   * exception `raisedAt` stamping (defaults to wall-clock).
   */
  async getView(
    orgId: string,
    bookingId: string,
    now: Date = new Date(),
  ): Promise<ReceiptedBookingView | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { organizationId: orgId, id: bookingId },
      select: {
        id: true,
        contactId: true,
        opportunityId: true,
        workTraceId: true,
        attendance: true,
        service: true,
        startsAt: true,
      },
    });
    if (!booking) return null;

    const [receipts, conversion, contact, revenueEvents, opportunity, workTrace, persisted] =
      await Promise.all([
        this.prisma.receipt.findMany({
          where: { organizationId: orgId, bookingId },
          select: { id: true, kind: true, status: true },
        }),
        this.prisma.conversionRecord.findFirst({
          where: { organizationId: orgId, bookingId },
          select: { sourceAdId: true, sourceCampaignId: true, sourceChannel: true },
        }),
        booking.contactId
          ? this.prisma.contact.findFirst({
              where: { organizationId: orgId, id: booking.contactId },
              select: {
                id: true,
                leadgenId: true,
                sourceType: true,
                firstTouchChannel: true,
                pdpaJurisdiction: true,
                consentGrantedAt: true,
                consentRevokedAt: true,
              },
            })
          : null,
        this.prisma.lifecycleRevenueEvent.findMany({
          where: { organizationId: orgId, bookingId },
          select: { id: true },
        }),
        booking.opportunityId
          ? this.prisma.opportunity.findFirst({
              where: { organizationId: orgId, id: booking.opportunityId },
              select: { estimatedValue: true },
            })
          : null,
        booking.workTraceId
          ? this.prisma.workTrace.findFirst({
              where: { organizationId: orgId, id: booking.workTraceId },
              select: { traceId: true, matchedPolicies: true, approvalId: true },
            })
          : null,
        // The persisted issuance snapshot (the deferred write-path's row), org-scoped per the F12
        // read-side IDOR lesson. Null for historical bookings created before the issuance hook; the
        // view then exposes only the live fields. attributionConfidence / exceptions stay lazily
        // derived above (re-evaluation against the persisted judgment is a separate, deferred concern).
        this.prisma.receiptedBooking.findFirst({
          where: { organizationId: orgId, bookingId },
          select: {
            issuedAt: true,
            expectedValueAtIssue: true,
            currency: true,
            attributionConfidence: true,
            overriddenBy: true,
            overrideReason: true,
            overriddenAt: true,
            exceptions: true,
          },
        }),
      ]);

    const sourceEvidence = {
      leadgenId: contact?.leadgenId ?? null,
      sourceAdId: conversion?.sourceAdId ?? null,
      sourceCampaignId: conversion?.sourceCampaignId ?? null,
      sourceType: contact?.sourceType ?? null,
      sourceChannel: conversion?.sourceChannel ?? contact?.firstTouchChannel ?? null,
    };
    const liveConfidence = scoreAttribution(sourceEvidence);
    // A persisted manual override is the human's explicit judgment and wins over the live-derived
    // rung (the one NON-recomputable attribution signal, spec 2026-06-15 resolution). Absent an
    // override, attribution stays lazily recomputed.
    const attributionConfidence: AttributionConfidence = persisted?.overriddenBy
      ? (persisted.attributionConfidence as AttributionConfidence)
      : liveConfidence;
    // Coerce the persisted Json column to the typed array; default [] when no persisted row.
    const persistedExceptions: SerializedExceptionEntry[] = (persisted?.exceptions ??
      []) as unknown as SerializedExceptionEntry[];
    // Feed the real overriddenBy (was hardcoded null) so manual_override raises from the column.
    // Keep duplicateContactRisk: false here: the sole source of duplicate_contact_risk on the
    // read path is the persisted-array carry below; routing it through both evaluateExceptions and
    // assembleViewExceptions would land the same code twice, breaking one-open-per-code.
    const recomputable = evaluateExceptions({
      attributionConfidence,
      // Null jurisdiction = PDPA not_applicable: no missing_consent (matches the booking gate and
      // the completeness report which scopes bookable to pdpaJurisdiction != null).
      pdpaJurisdiction: (contact?.pdpaJurisdiction ?? null) as PdpaJurisdiction | null,
      consentGrantedAt: contact?.consentGrantedAt ?? null,
      consentRevokedAt: contact?.consentRevokedAt ?? null,
      overriddenBy: persisted?.overriddenBy ?? null,
      duplicateContactRisk: false,
      now,
    });
    const exceptions = assembleViewExceptions(recomputable, persistedExceptions);

    return {
      bookingId: booking.id,
      organizationId: orgId,
      attributionConfidence,
      exceptions,
      receipts: receipts.map((r) => ({ id: r.id, kind: r.kind, status: r.status })),
      contactKey: contact?.id ?? null,
      consentGrantedAt: contact?.consentGrantedAt ?? null,
      consentRevokedAt: contact?.consentRevokedAt ?? null,
      sourceEvidence,
      traceId: workTrace?.traceId ?? null,
      matchedPolicies: workTrace?.matchedPolicies ?? null,
      humanApprovalId: workTrace?.approvalId ?? null,
      attendanceState: booking.attendance ?? null,
      // Booking handles for the owner worklist (non-PII): always present on a real Booking row.
      service: booking.service,
      startsAt: booking.startsAt,
      paymentEventIds: revenueEvents.map((e) => e.id),
      expectedValue: opportunity?.estimatedValue ?? null,
      // Persisted issuance snapshot (null on the lazy/historical path). issuedAt presence is the
      // discriminator the revenue rollup uses to choose snapshot-vs-live, so it is set ONLY from a
      // real persisted row (never defaulted to now).
      issuedAt: persisted?.issuedAt ?? null,
      expectedValueAtIssue: persisted?.expectedValueAtIssue ?? null,
      currency: persisted?.currency ?? null,
      overriddenBy: persisted?.overriddenBy ?? null,
      overrideReason: persisted?.overrideReason ?? null,
      overriddenAt: persisted?.overriddenAt ?? null,
    };
  }

  /**
   * Assemble views for every receipted booking in [from, to). The cohort is the SAME distinct
   * booked|held calendar-receipt window as `PrismaReceiptStore.countReceiptedBookingsInWindow`, so
   * `listForCohort(...).length === countReceiptedBookingsInWindow(...)`, so the list and north-star
   * count never disagree. The window is keyed on the calendar receipt's `createdAt`, NOT the persisted
   * `ReceiptedBooking.issuedAt`: the issuance write-path is deferred, so there is no persisted cohort
   * to read and each view is assembled lazily. Orphaned cohort rows (booking hard-deleted) resolve to
   * null and are filtered out.
   */
  async listForCohort(
    orgId: string,
    from: Date,
    to: Date,
    now: Date = new Date(),
  ): Promise<ReceiptedBookingView[]> {
    const rows = await this.prisma.receipt.findMany({
      where: {
        organizationId: orgId,
        kind: "calendar",
        status: { in: ["booked", "held"] },
        createdAt: { gte: from, lt: to },
        bookingId: { not: null },
      },
      select: { bookingId: true },
      distinct: ["bookingId"],
    });
    const views = await Promise.all(
      // bookingId is non-null by the `{ not: null }` filter above.
      rows.map((r) => this.getView(orgId, r.bookingId as string, now)),
    );
    return views.filter((v): v is ReceiptedBookingView => v !== null);
  }

  /**
   * Apply a governed reconcile action to a booking's persisted ReceiptedBooking row, reached ONLY
   * through PlatformIngress.submit (the handler returns an outcome; PlatformIngress writes the
   * canonical WorkTrace). Idempotent + keyed on bookingId; org-scoped on EVERY leg (the F12 write-side
   * IDOR lesson). NaN-safe via snapshotCents; JSON-native exceptions (no Date) so the write cannot
   * raise a Prisma Json error.
   *
   * - override_attribution: writes the override columns. PRESENT row -> org-scoped updateMany (the
   *   value snapshot stays frozen); a count===0 concurrent delete -> not_found. ABSENT row -> governed
   *   late issuance: create a row snapshotting the live Opportunity.estimatedValue (org-scoped read)
   *   into expectedValueAtIssue with issuedAt=now and exceptions=[] (manual_override is column-derived,
   *   raised on the read path from overriddenBy). A P2002 unique-bookingId race converges to the
   *   org-scoped updateMany.
   * - flag_duplicate / resolve_exception: require an existing row (absent -> not_issued). The
   *   exceptions array is reconciled append-only via mergeExceptions, scoped to {duplicate_contact_risk}.
   *   resolve_exception validates the code is in the v1-supported set BEFORE the merge; an unsupported
   *   code -> unsupported_code, so it can never stamp a false resolvedAt on a live signal.
   */
  async applyReconcile(input: {
    orgId: string;
    bookingId: string;
    action: ReconcileBookingParameters;
    actorId: string;
    now?: Date;
  }): Promise<ApplyReconcileResult> {
    const now = input.now ?? new Date();
    const { orgId, bookingId, action } = input;

    const booking = await this.prisma.booking.findFirst({
      where: { organizationId: orgId, id: bookingId },
      select: { id: true, opportunityId: true },
    });
    if (!booking) return { status: "not_found" };

    const prior = await this.prisma.receiptedBooking.findFirst({
      where: { organizationId: orgId, bookingId },
      select: { id: true, exceptions: true },
    });

    if (action.action === "override_attribution") {
      if (prior) {
        const updated = await this.prisma.receiptedBooking.updateMany({
          where: { organizationId: orgId, bookingId },
          data: {
            attributionConfidence: action.confidence,
            attributionUpdatedAt: now,
            overriddenBy: input.actorId,
            overrideReason: action.reason,
            overriddenAt: now,
            lastEvaluatedAt: now,
          },
        });
        if (updated.count === 0) return { status: "not_found" };
        return { status: "applied", created: false };
      }
      // Absent row: governed late issuance. Snapshot the live Opportunity value so the revenue rollup
      // (which keys snapshot-vs-live on issuedAt != null) does not drop this booking's revenue to zero.
      const opportunity = booking.opportunityId
        ? await this.prisma.opportunity.findFirst({
            where: { organizationId: orgId, id: booking.opportunityId },
            select: { estimatedValue: true },
          })
        : null;
      try {
        await this.prisma.receiptedBooking.create({
          data: {
            organizationId: orgId,
            bookingId,
            issuedAt: now,
            attributionConfidence: action.confidence,
            attributionUpdatedAt: now,
            expectedValueAtIssue: snapshotCents(opportunity?.estimatedValue ?? null),
            currency: null,
            exceptions: [] as unknown as Prisma.InputJsonValue,
            overriddenBy: input.actorId,
            overrideReason: action.reason,
            overriddenAt: now,
            lastEvaluatedAt: now,
          },
        });
        return { status: "applied", created: true };
      } catch (err) {
        // A concurrent issuance/override won the unique-bookingId race; converge to the org-scoped
        // updateMany so the action stays idempotent.
        if (isUniqueConstraintError(err)) {
          const updated = await this.prisma.receiptedBooking.updateMany({
            where: { organizationId: orgId, bookingId },
            data: {
              attributionConfidence: action.confidence,
              attributionUpdatedAt: now,
              overriddenBy: input.actorId,
              overrideReason: action.reason,
              overriddenAt: now,
              lastEvaluatedAt: now,
            },
          });
          if (updated.count === 0) return { status: "not_found" };
          return { status: "applied", created: false };
        }
        throw err;
      }
    }

    // flag_duplicate / resolve_exception both reconcile the exceptions ARRAY and require an existing row.
    if (action.action === "resolve_exception" && !RESOLVABLE_CODES.has(action.code)) {
      // Reject BEFORE any merge: never stamp a false resolvedAt on a live recomputable signal.
      return { status: "unsupported_code" };
    }
    if (!prior) return { status: "not_issued" };

    const priorExceptions = (Array.isArray(prior.exceptions)
      ? prior.exceptions
      : []) as unknown as SerializedExceptionEntry[];
    const desired: SerializedExceptionEntry[] =
      action.action === "flag_duplicate"
        ? [
            {
              code: "duplicate_contact_risk",
              detail: action.detail,
              raisedAt: now.toISOString(),
              resolvedAt: null,
            },
          ]
        : [];
    const merged = mergeExceptions(
      priorExceptions,
      desired,
      now,
      new Set(["duplicate_contact_risk"]),
    );
    const updated = await this.prisma.receiptedBooking.updateMany({
      where: { organizationId: orgId, bookingId },
      data: {
        exceptions: merged as unknown as Prisma.InputJsonValue,
        lastEvaluatedAt: now,
      },
    });
    if (updated.count === 0) return { status: "not_found" };
    return { status: "applied", created: false };
  }
}
