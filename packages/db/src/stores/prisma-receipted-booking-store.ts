import type { PrismaDbClient } from "../prisma-db.js";
import type { ReceiptedBookingView } from "@switchboard/schemas";
import { scoreAttribution, evaluateExceptions } from "@switchboard/core";

/**
 * Read-projection store for the receipted-booking view (Ledger's data plane, spec slice 4).
 *
 * The view is assembled LAZILY over existing foreign keys (Booking + Receipt + ConversionRecord +
 * Contact + LifecycleRevenueEvent + Opportunity + WorkTrace). No persisted `ReceiptedBooking` row is
 * read: the issuance write-path is deferred until a consumer (the Ledger agent / weekly UI / an
 * override workflow) exists. `attributionConfidence` and `exceptions` are derived on the fly via the
 * pure `core/receipts` functions, so the projection never drifts from the source facts.
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
      },
    });
    if (!booking) return null;

    const [receipts, conversion, contact, revenueEvents, opportunity, workTrace] =
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
      ]);

    const sourceEvidence = {
      leadgenId: contact?.leadgenId ?? null,
      sourceAdId: conversion?.sourceAdId ?? null,
      sourceCampaignId: conversion?.sourceCampaignId ?? null,
      sourceType: contact?.sourceType ?? null,
      sourceChannel: conversion?.sourceChannel ?? contact?.firstTouchChannel ?? null,
    };
    const attributionConfidence = scoreAttribution(sourceEvidence);
    const exceptions = evaluateExceptions({
      attributionConfidence,
      consentGrantedAt: contact?.consentGrantedAt ?? null,
      consentRevokedAt: contact?.consentRevokedAt ?? null,
      overriddenBy: null,
      // No persisted duplicate-contact signal in the lazy read path; the write-path will set it.
      duplicateContactRisk: false,
      now,
    });

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
      paymentEventIds: revenueEvents.map((e) => e.id),
      expectedValue: opportunity?.estimatedValue ?? null,
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
}
