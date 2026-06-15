import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiptedBookingViewSchema } from "@switchboard/schemas";
import { PrismaReceiptedBookingStore } from "../prisma-receipted-booking-store.js";

const now = new Date("2026-06-15T00:00:00Z");
const consentAt = new Date("2026-06-10T00:00:00Z");

function makeMockPrisma() {
  return {
    booking: { findFirst: vi.fn().mockResolvedValue(null) },
    receipt: { findMany: vi.fn().mockResolvedValue([]) },
    conversionRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    contact: { findFirst: vi.fn().mockResolvedValue(null) },
    lifecycleRevenueEvent: { findMany: vi.fn().mockResolvedValue([]) },
    opportunity: { findFirst: vi.fn().mockResolvedValue(null) },
    workTrace: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}

describe("PrismaReceiptedBookingStore.getView", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaReceiptedBookingStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaReceiptedBookingStore(prisma as never);
  });

  it("returns null when the booking is absent or org-mismatched (orphan filtered, not surfaced)", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce(null);
    const result = await store.getView("org-1", "missing", now);
    expect(result).toBeNull();
    // No further legs queried once the booking guard fails.
    expect(prisma.receipt.findMany).not.toHaveBeenCalled();
  });

  it("assembles a fully-populated view and the real output passes the schema seam", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-1",
      contactId: "ct-1",
      opportunityId: "opp-1",
      workTraceId: "wt-1",
      attendance: "attended",
    });
    prisma.receipt.findMany.mockResolvedValueOnce([
      { id: "rcpt-1", kind: "calendar", status: "booked" },
    ]);
    prisma.conversionRecord.findFirst.mockResolvedValueOnce({
      sourceAdId: "ad-1",
      sourceCampaignId: "camp-1",
      sourceChannel: "whatsapp",
    });
    prisma.contact.findFirst.mockResolvedValueOnce({
      id: "ct-1",
      leadgenId: "lead-1",
      sourceType: "ctwa",
      firstTouchChannel: "instagram",
      consentGrantedAt: consentAt,
      consentRevokedAt: null,
    });
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValueOnce([{ id: "pe-1" }]);
    prisma.opportunity.findFirst.mockResolvedValueOnce({ estimatedValue: 45000 });
    prisma.workTrace.findFirst.mockResolvedValueOnce({
      traceId: "trace-1",
      matchedPolicies: "[]",
      approvalId: null,
    });

    const view = await store.getView("org-1", "bk-1", now);

    // The producer -> consumer seam: the REAL getView output must satisfy the schema.
    expect(ReceiptedBookingViewSchema.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({
      bookingId: "bk-1",
      organizationId: "org-1",
      attributionConfidence: "deterministic", // leadgenId present => hard click id
      exceptions: [], // attributed + consent granted => no flags
      receipts: [{ id: "rcpt-1", kind: "calendar", status: "booked" }],
      contactKey: "ct-1",
      consentGrantedAt: consentAt,
      consentRevokedAt: null,
      sourceEvidence: {
        leadgenId: "lead-1",
        sourceAdId: "ad-1",
        sourceCampaignId: "camp-1",
        sourceType: "ctwa",
        sourceChannel: "whatsapp", // ConversionRecord wins over Contact.firstTouchChannel
      },
      traceId: "trace-1",
      matchedPolicies: "[]",
      humanApprovalId: null,
      attendanceState: "attended",
      paymentEventIds: ["pe-1"],
      expectedValue: 45000,
    });
  });

  it("org-scopes EVERY join leg (F12 read-side IDOR)", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-1",
      contactId: "ct-1",
      opportunityId: "opp-1",
      workTraceId: "wt-1",
      attendance: null,
    });
    prisma.contact.findFirst.mockResolvedValueOnce({ id: "ct-1" });

    await store.getView("org-1", "bk-1", now);

    for (const call of [
      prisma.booking.findFirst,
      prisma.receipt.findMany,
      prisma.conversionRecord.findFirst,
      prisma.contact.findFirst,
      prisma.lifecycleRevenueEvent.findMany,
      prisma.opportunity.findFirst,
      prisma.workTrace.findFirst,
    ]) {
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org-1" }),
        }),
      );
    }
  });

  it("falls back to Contact.firstTouchChannel when no ConversionRecord (resolves to medium)", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-2",
      contactId: "ct-2",
      opportunityId: null,
      workTraceId: null,
      attendance: null,
    });
    prisma.conversionRecord.findFirst.mockResolvedValueOnce(null);
    prisma.contact.findFirst.mockResolvedValueOnce({
      id: "ct-2",
      leadgenId: null,
      sourceType: null,
      firstTouchChannel: "instagram",
      consentGrantedAt: consentAt,
      consentRevokedAt: null,
    });

    const view = await store.getView("org-1", "bk-2", now);

    expect(view?.sourceEvidence.sourceChannel).toBe("instagram");
    expect(view?.attributionConfidence).toBe("medium"); // bare channel only
    // Nullable FK legs are not queried when the FK is absent.
    expect(prisma.opportunity.findFirst).not.toHaveBeenCalled();
    expect(prisma.workTrace.findFirst).not.toHaveBeenCalled();
  });

  it("raises missing_source + missing_consent for an unattributed, consent-less booking", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-3",
      contactId: "ct-3",
      opportunityId: null,
      workTraceId: null,
      attendance: null,
    });
    prisma.contact.findFirst.mockResolvedValueOnce({
      id: "ct-3",
      leadgenId: null,
      sourceType: null,
      firstTouchChannel: null,
      consentGrantedAt: null,
      consentRevokedAt: null,
    });

    const view = await store.getView("org-1", "bk-3", now);

    expect(view?.attributionConfidence).toBe("unattributed");
    const codes = view?.exceptions.map((e) => e.code).sort();
    expect(codes).toEqual(["missing_consent", "missing_source"]);
  });
});

describe("PrismaReceiptedBookingStore.listForCohort", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaReceiptedBookingStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaReceiptedBookingStore(prisma as never);
  });

  it("derives the cohort from the same booked|held calendar-receipt window as the slice-3 count, org-scoped", async () => {
    const from = new Date("2026-06-08T00:00:00Z");
    const to = new Date("2026-06-15T00:00:00Z");
    // First receipt.findMany call = the cohort query (distinct bookingIds in the window).
    prisma.receipt.findMany.mockResolvedValueOnce([{ bookingId: "b1" }]);
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "b1",
      contactId: null,
      opportunityId: null,
      workTraceId: null,
      attendance: null,
    });

    await store.listForCohort("org-1", from, to, now);

    expect(prisma.receipt.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId: "org-1",
        kind: "calendar",
        status: { in: ["booked", "held"] },
        createdAt: { gte: from, lt: to },
        bookingId: { not: null },
      },
      select: { bookingId: true },
      distinct: ["bookingId"],
    });
  });

  it("assembles one view per cohort booking and filters orphaned (null) rows", async () => {
    const from = new Date("2026-06-08T00:00:00Z");
    const to = new Date("2026-06-15T00:00:00Z");
    prisma.receipt.findMany.mockResolvedValueOnce([{ bookingId: "b1" }, { bookingId: "b2" }]);
    // b1 resolves to a real booking; b2 is orphaned (booking hard-deleted) -> getView returns null.
    prisma.booking.findFirst
      .mockResolvedValueOnce({
        id: "b1",
        contactId: null,
        opportunityId: null,
        workTraceId: null,
        attendance: null,
      })
      .mockResolvedValueOnce(null);

    const views = await store.listForCohort("org-1", from, to, now);

    expect(views).toHaveLength(1);
    expect(views[0]!.bookingId).toBe("b1");
    expect(ReceiptedBookingViewSchema.safeParse(views[0]).success).toBe(true);
  });

  it("returns an empty array when no calendar receipts fall in the window", async () => {
    prisma.receipt.findMany.mockResolvedValueOnce([]);
    const views = await store.listForCohort(
      "org-1",
      new Date("2026-06-08T00:00:00Z"),
      new Date("2026-06-15T00:00:00Z"),
      now,
    );
    expect(views).toEqual([]);
  });
});
