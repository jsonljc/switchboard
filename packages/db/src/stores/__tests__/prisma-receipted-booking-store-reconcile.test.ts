import { describe, it, expect, vi } from "vitest";
import { PrismaReceiptedBookingStore } from "../prisma-receipted-booking-store.js";

// Shared read-path mock (mirrors the getView suite); applyReconcile extends it with write methods.
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
