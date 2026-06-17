import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiptedBookingViewSchema } from "@switchboard/schemas";
import { PrismaReceiptedBookingStore } from "../prisma-receipted-booking-store.js";

const now = new Date("2026-06-15T00:00:00Z");
const consentAt = new Date("2026-06-10T00:00:00Z");
const startsAt = new Date("2026-06-16T02:00:00Z");

function makeMockPrisma() {
  return {
    booking: { findFirst: vi.fn().mockResolvedValue(null) },
    receipt: { findMany: vi.fn().mockResolvedValue([]) },
    conversionRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    contact: { findFirst: vi.fn().mockResolvedValue(null) },
    lifecycleRevenueEvent: { findMany: vi.fn().mockResolvedValue([]) },
    opportunity: { findFirst: vi.fn().mockResolvedValue(null) },
    workTrace: { findFirst: vi.fn().mockResolvedValue(null) },
    receiptedBooking: { findFirst: vi.fn().mockResolvedValue(null) },
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
      service: "Botox consult",
      startsAt,
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
      service: "Botox consult",
      startsAt,
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
      service: "Facial",
      startsAt,
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
      prisma.receiptedBooking.findFirst,
    ]) {
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org-1" }),
        }),
      );
    }
  });

  it("populates the persisted snapshot fields when an issuance row exists", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-1",
      contactId: "ct-1",
      opportunityId: "opp-1",
      workTraceId: null,
      attendance: null,
      service: "Facial",
      startsAt,
    });
    prisma.opportunity.findFirst.mockResolvedValueOnce({ estimatedValue: 30000 }); // live differs
    const issuedAt = new Date("2026-06-14T00:00:00Z");
    prisma.receiptedBooking.findFirst.mockResolvedValueOnce({
      issuedAt,
      expectedValueAtIssue: 45000,
      currency: "SGD",
      overriddenBy: null,
      overrideReason: null,
      overriddenAt: null,
    });

    const view = await store.getView("org-1", "bk-1", now);

    expect(view?.issuedAt).toEqual(issuedAt);
    expect(view?.expectedValueAtIssue).toBe(45000); // snapshot, not the live 30000
    expect(view?.currency).toBe("SGD");
    expect(view?.expectedValue).toBe(30000); // live still exposed alongside
  });

  it("leaves snapshot fields null when no issuance row exists (lazy/historical path)", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-2",
      contactId: null,
      opportunityId: null,
      workTraceId: null,
      attendance: null,
      service: "Facial",
      startsAt,
    });
    // receiptedBooking.findFirst defaults to null (no persisted row)
    const view = await store.getView("org-1", "bk-2", now);

    expect(view?.issuedAt ?? null).toBeNull();
    expect(view?.expectedValueAtIssue ?? null).toBeNull();
    expect(view?.currency ?? null).toBeNull();
  });

  it("falls back to Contact.firstTouchChannel when no ConversionRecord (resolves to medium)", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-2",
      contactId: "ct-2",
      opportunityId: null,
      workTraceId: null,
      attendance: null,
      service: "Facial",
      startsAt,
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
    // prettier-ignore
    prisma.booking.findFirst.mockResolvedValueOnce({ id: "bk-3", contactId: "ct-3", opportunityId: null, workTraceId: null, attendance: null, service: "Facial", startsAt });
    prisma.contact.findFirst.mockResolvedValueOnce({
      id: "ct-3",
      leadgenId: null,
      sourceType: null,
      firstTouchChannel: null,
      pdpaJurisdiction: "SG", // in PDPA scope -> absent consent raises missing_consent
      consentGrantedAt: null,
      consentRevokedAt: null,
    });

    const view = await store.getView("org-1", "bk-3", now);

    expect(view?.attributionConfidence).toBe("unattributed");
    const codes = view?.exceptions.map((e) => e.code).sort();
    expect(codes).toEqual(["missing_consent", "missing_source"]);
  });

  it("does NOT raise missing_consent for a null-jurisdiction contact (not-applicable)", async () => {
    // prettier-ignore
    prisma.booking.findFirst.mockResolvedValueOnce({ id: "bk-4", contactId: "ct-4", opportunityId: null, workTraceId: null, attendance: null, service: "Facial", startsAt });
    prisma.contact.findFirst.mockResolvedValueOnce({
      id: "ct-4",
      leadgenId: "lead_4", // attributed -> no missing_source
      pdpaJurisdiction: null, // not-applicable -> missing_consent must NOT pollute the worklist
      consentGrantedAt: null,
      consentRevokedAt: null,
    });

    const view = await store.getView("org-1", "bk-4", now);

    // empty set proves missing_consent (and every other code) is absent for a no-jurisdiction contact
    expect(view?.exceptions.map((e) => e.code)).toEqual([]);
  });
});

describe("PrismaReceiptedBookingStore.getView override + duplicate (PR-1 hardcode kill)", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaReceiptedBookingStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaReceiptedBookingStore(prisma as never);
  });

  const issuedAt = new Date("2026-06-10T00:00:00Z");
  const dupRaisedAt = "2026-06-12T00:00:00Z";

  function baseBooking(id: string = "bk-1") {
    return {
      id,
      contactId: null,
      opportunityId: null,
      workTraceId: null,
      attendance: null,
      service: "Botox",
      startsAt,
    };
  }

  it("overridden row: persisted overriddenBy -> attributionConfidence='high', manual_override raised, missing_source absent", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce(baseBooking());
    prisma.receiptedBooking.findFirst.mockResolvedValueOnce({
      issuedAt,
      expectedValueAtIssue: 5000,
      currency: "SGD",
      attributionConfidence: "high",
      overriddenBy: "user_1",
      overrideReason: "owner knows source",
      overriddenAt: new Date("2026-06-12T00:00:00Z"),
      exceptions: [],
    });

    const view = await store.getView("org-1", "bk-1", now);

    expect(view).not.toBeNull();
    expect(view!.attributionConfidence).toBe("high");
    const codes = view!.exceptions.map((e) => e.code);
    expect(codes).toContain("manual_override");
    expect(codes).not.toContain("missing_source");
    expect(ReceiptedBookingViewSchema.safeParse(view).success).toBe(true);
  });

  it("persisted OPEN duplicate_contact_risk -> appears in exceptions with raisedAt as Date", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce(baseBooking());
    prisma.receiptedBooking.findFirst.mockResolvedValueOnce({
      issuedAt,
      expectedValueAtIssue: null,
      currency: null,
      attributionConfidence: "high",
      overriddenBy: null,
      overrideReason: null,
      overriddenAt: null,
      exceptions: [{ code: "duplicate_contact_risk", raisedAt: dupRaisedAt, resolvedAt: null }],
    });

    const view = await store.getView("org-1", "bk-1", now);

    expect(view).not.toBeNull();
    const dup = view!.exceptions.find((e) => e.code === "duplicate_contact_risk");
    expect(dup).toBeDefined();
    expect(dup!.raisedAt).toBeInstanceOf(Date);
    expect(dup!.raisedAt).toEqual(new Date(dupRaisedAt));
    expect(ReceiptedBookingViewSchema.safeParse(view).success).toBe(true);
  });

  it("persisted RESOLVED duplicate_contact_risk -> excluded from view exceptions", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce(baseBooking());
    prisma.receiptedBooking.findFirst.mockResolvedValueOnce({
      issuedAt,
      expectedValueAtIssue: null,
      currency: null,
      attributionConfidence: "high",
      overriddenBy: null,
      overrideReason: null,
      overriddenAt: null,
      exceptions: [
        {
          code: "duplicate_contact_risk",
          raisedAt: dupRaisedAt,
          resolvedAt: "2026-06-14T00:00:00Z",
        },
      ],
    });

    const view = await store.getView("org-1", "bk-1", now);

    expect(view).not.toBeNull();
    const codes = view!.exceptions.map((e) => e.code);
    expect(codes).not.toContain("duplicate_contact_risk");
  });

  it("no persisted row (historical) -> live confidence, no manual_override, no duplicate", async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: "bk-hist",
      contactId: null,
      opportunityId: null,
      workTraceId: null,
      attendance: null,
      service: "Facial",
      startsAt,
    });
    // receiptedBooking.findFirst defaults to null (no persisted row)

    const view = await store.getView("org-1", "bk-hist", now);

    expect(view).not.toBeNull();
    expect(view!.attributionConfidence).toBe("unattributed");
    const codes = view!.exceptions.map((e) => e.code);
    expect(codes).not.toContain("manual_override");
    expect(codes).not.toContain("duplicate_contact_risk");
    // A contactless booking has no PDPA jurisdiction (not_applicable) -> no missing_consent.
    expect(codes).not.toContain("missing_consent");
    expect(codes).toContain("missing_source");
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
      service: "Facial",
      startsAt,
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
        service: "Facial",
        startsAt,
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

describe("PrismaReceiptedBookingStore.applyReconcile", () => {
  // Extends the shared mock with the write methods applyReconcile needs.
  function makeWriteMockPrisma() {
    return {
      ...makeMockPrisma(),
      receiptedBooking: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: "rb_new" }),
      },
      opportunity: { findFirst: vi.fn().mockResolvedValue(null) },
    };
  }

  const reconcileNow = new Date("2026-06-15T00:00:00.000Z");
  const overrideAction = {
    action: "override_attribution" as const,
    bookingId: "bk_1",
    confidence: "high" as const,
    reason: "owner knows source",
  };

  function applyArgs(action: typeof overrideAction | Record<string, unknown>) {
    return {
      orgId: "org_1",
      bookingId: "bk_1",
      action: action as never,
      actorId: "user_42",
      now: reconcileNow,
    };
  }

  it("returns not_found when the booking is absent for the org (no write attempted)", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue(null);
    const store = new PrismaReceiptedBookingStore(prisma as never);
    expect(await store.applyReconcile(applyArgs(overrideAction))).toEqual({ status: "not_found" });
    expect(prisma.receiptedBooking.create).not.toHaveBeenCalled();
    expect(prisma.receiptedBooking.updateMany).not.toHaveBeenCalled();
    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1", id: "bk_1" } }),
    );
  });

  it("override existing row: updateMany sets the override columns, leaves the value snapshot frozen", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: "op_1" });
    prisma.receiptedBooking.findFirst.mockResolvedValue({ id: "rb_1", exceptions: [] });
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 1 });
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(applyArgs(overrideAction));

    expect(res).toEqual({ status: "applied", created: false });
    expect(prisma.receiptedBooking.create).not.toHaveBeenCalled();
    const call = prisma.receiptedBooking.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ organizationId: "org_1", bookingId: "bk_1" });
    expect(call.data.attributionConfidence).toBe("high");
    expect(call.data.overriddenBy).toBe("user_42");
    expect(call.data.overrideReason).toBe("owner knows source");
    expect(call.data.attributionUpdatedAt).toEqual(reconcileNow);
    expect(call.data.overriddenAt).toEqual(reconcileNow);
    expect(call.data.lastEvaluatedAt).toEqual(reconcileNow);
    // The value snapshot stays frozen on update.
    expect(call.data).not.toHaveProperty("expectedValueAtIssue");
    expect(call.data).not.toHaveProperty("issuedAt");
    expect(call.data).not.toHaveProperty("currency");
    // override_attribution does NOT touch the exceptions array (manual_override is column-derived).
    expect(call.data).not.toHaveProperty("exceptions");
  });

  it("override existing row: a concurrent-delete updateMany no-match (count 0) aborts as not_found", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue({ id: "rb_1", exceptions: [] });
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 0 });
    const store = new PrismaReceiptedBookingStore(prisma as never);
    expect(await store.applyReconcile(applyArgs(overrideAction))).toEqual({ status: "not_found" });
  });

  it("override absent row: creates a row snapshotting the live Opportunity value, exceptions=[], issuedAt=now", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: "op_1" });
    prisma.receiptedBooking.findFirst.mockResolvedValue(null);
    prisma.opportunity.findFirst.mockResolvedValue({ estimatedValue: 45000 });
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(applyArgs(overrideAction));

    expect(res).toEqual({ status: "applied", created: true });
    const data = prisma.receiptedBooking.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.organizationId).toBe("org_1");
    expect(data.bookingId).toBe("bk_1");
    expect(data.expectedValueAtIssue).toBe(45000);
    expect(data.issuedAt).toEqual(reconcileNow);
    expect(data.attributionConfidence).toBe("high");
    expect(data.overriddenBy).toBe("user_42");
    expect(data.currency).toBeNull();
    expect(data.exceptions).toEqual([]);
    expect(prisma.opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1", id: "op_1" } }),
    );
  });

  it("override absent row with no opportunity: snapshots a null value and never reads opportunity", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue(null);
    const store = new PrismaReceiptedBookingStore(prisma as never);

    await store.applyReconcile(applyArgs(overrideAction));

    const data = prisma.receiptedBooking.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.expectedValueAtIssue).toBeNull();
    expect(prisma.opportunity.findFirst).not.toHaveBeenCalled();
  });

  it("override create P2002 race: converges to the org-scoped updateMany, created=false", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue(null);
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.receiptedBooking.create.mockRejectedValue(p2002);
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 1 });
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(applyArgs(overrideAction));

    expect(res).toEqual({ status: "applied", created: false });
    const call = prisma.receiptedBooking.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toEqual({ organizationId: "org_1", bookingId: "bk_1" });
  });

  it("override create non-P2002 error: rethrows", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue(null);
    prisma.receiptedBooking.create.mockRejectedValue(new Error("db exploded"));
    const store = new PrismaReceiptedBookingStore(prisma as never);
    await expect(store.applyReconcile(applyArgs(overrideAction))).rejects.toThrow("db exploded");
  });

  it("flag_duplicate appends an open duplicate_contact_risk via merge, org-scoped", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue({ id: "rb_1", exceptions: [] });
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 1 });
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(
      applyArgs({ action: "flag_duplicate", bookingId: "bk_1", detail: "same phone as bk_9" }),
    );

    expect(res).toEqual({ status: "applied", created: false });
    const call = prisma.receiptedBooking.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: { exceptions: unknown; lastEvaluatedAt: Date };
    };
    expect(call.where).toEqual({ organizationId: "org_1", bookingId: "bk_1" });
    expect(call.data.exceptions).toEqual([
      {
        code: "duplicate_contact_risk",
        detail: "same phone as bk_9",
        raisedAt: "2026-06-15T00:00:00.000Z",
        resolvedAt: null,
      },
    ]);
    expect(call.data.lastEvaluatedAt).toEqual(reconcileNow);
  });

  it("flag_duplicate on an absent row returns not_issued (no row to append to)", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue(null);
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(
      applyArgs({ action: "flag_duplicate", bookingId: "bk_1", detail: "x" }),
    );

    expect(res).toEqual({ status: "not_issued" });
    expect(prisma.receiptedBooking.updateMany).not.toHaveBeenCalled();
  });

  it("resolve_exception stamps resolvedAt on the open duplicate entry", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue({
      id: "rb_1",
      exceptions: [
        { code: "duplicate_contact_risk", raisedAt: "2026-06-12T00:00:00.000Z", resolvedAt: null },
      ],
    });
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 1 });
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(
      applyArgs({ action: "resolve_exception", bookingId: "bk_1", code: "duplicate_contact_risk" }),
    );

    expect(res).toEqual({ status: "applied", created: false });
    const call = prisma.receiptedBooking.updateMany.mock.calls[0]![0] as {
      data: { exceptions: unknown };
    };
    expect(call.data.exceptions).toEqual([
      {
        code: "duplicate_contact_risk",
        raisedAt: "2026-06-12T00:00:00.000Z",
        resolvedAt: "2026-06-15T00:00:00.000Z",
      },
    ]);
  });

  it("resolve_exception with an unsupported code returns unsupported_code BEFORE any merge/write", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue({ id: "rb_1", exceptions: [] });
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(
      applyArgs({ action: "resolve_exception", bookingId: "bk_1", code: "missing_source" }),
    );

    expect(res).toEqual({ status: "unsupported_code" });
    expect(prisma.receiptedBooking.updateMany).not.toHaveBeenCalled();
  });

  it("flag_duplicate updateMany no-match (count 0) aborts as not_found", async () => {
    const prisma = makeWriteMockPrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue({ id: "rb_1", exceptions: [] });
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 0 });
    const store = new PrismaReceiptedBookingStore(prisma as never);

    const res = await store.applyReconcile(
      applyArgs({ action: "flag_duplicate", bookingId: "bk_1", detail: "x" }),
    );
    expect(res).toEqual({ status: "not_found" });
  });
});
