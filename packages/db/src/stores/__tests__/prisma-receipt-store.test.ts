import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaReceiptStore } from "../prisma-receipt-store.js";

const now = new Date("2026-06-06T12:00:00Z");

function makeMockPrisma() {
  return {
    receipt: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcpt-1",
    organizationId: "org-1",
    kind: "calendar",
    tier: "T1_FETCH_BACK",
    status: "booked",
    bookingId: "bk-1",
    opportunityId: "opp-1",
    revenueEventId: null,
    connectionId: null,
    provider: null,
    externalRef: null,
    amount: null,
    currency: null,
    evidence: { kind: "calendar", basis: "calendar_confirmed", calendarEventId: "gcal_1" },
    capturedBy: "calendar-book",
    verifiedAt: null,
    workTraceId: "wt-1",
    createdAt: now,
    ...overrides,
  };
}

const mintInput = {
  organizationId: "org-1",
  kind: "calendar" as const,
  tier: "T1_FETCH_BACK" as const,
  status: "booked" as const,
  bookingId: "bk-1",
  capturedBy: "calendar-book",
  evidence: {
    kind: "calendar" as const,
    basis: "calendar_confirmed" as const,
    calendarEventId: "gcal_1",
  },
};

describe("PrismaReceiptStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaReceiptStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaReceiptStore(prisma as never);
  });

  it("mint uses tx client instead of this.prisma when tx is provided", async () => {
    const txClient = { receipt: { create: vi.fn().mockResolvedValue(makeRow()) } };
    const result = await store.mint(mintInput, txClient as never);
    expect(txClient.receipt.create).toHaveBeenCalledTimes(1);
    expect(prisma.receipt.create).not.toHaveBeenCalled();
    expect(result.status).toBe("booked");
  });

  it("mint falls back to this.prisma when no tx is provided", async () => {
    prisma.receipt.create.mockResolvedValue(makeRow());
    await store.mint(mintInput);
    expect(prisma.receipt.create).toHaveBeenCalledTimes(1);
    expect(prisma.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        organizationId: "org-1",
        kind: "calendar",
        status: "booked",
        bookingId: "bk-1",
      }),
    });
  });

  it("findByBooking scopes the where clause to organizationId AND bookingId", async () => {
    prisma.receipt.findMany.mockResolvedValue([makeRow()]);
    const result = await store.findByBooking("org-1", "bk-1");
    expect(prisma.receipt.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", bookingId: "bk-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result[0]!.id).toBe("rcpt-1");
  });

  describe("mint — idempotency guard on externalRef", () => {
    it("returns the existing row and skips create when findFirst hits on (org, kind, externalRef)", async () => {
      const existingRow = makeRow({ externalRef: "ch_stripe_123", kind: "payment" });
      const mintWithRef = {
        ...mintInput,
        kind: "payment" as const,
        externalRef: "ch_stripe_123",
      };

      // First call: no existing row — creates
      prisma.receipt.findFirst.mockResolvedValueOnce(null);
      prisma.receipt.create.mockResolvedValueOnce(existingRow);
      await store.mint(mintWithRef);

      // Second call: findFirst returns the existing row — create must NOT fire
      prisma.receipt.findFirst.mockResolvedValueOnce(existingRow);
      const result = await store.mint(mintWithRef);

      expect(prisma.receipt.create).toHaveBeenCalledTimes(1);
      expect(prisma.receipt.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.receipt.findFirst).toHaveBeenLastCalledWith({
        where: {
          organizationId: "org-1",
          kind: "payment",
          externalRef: "ch_stripe_123",
        },
      });
      expect(result.externalRef).toBe("ch_stripe_123");
      expect(result.id).toBe("rcpt-1");
    });

    it("does NOT call findFirst for calendar receipts with null externalRef (skips guard)", async () => {
      // mintInput has no externalRef (defaults to null / undefined)
      prisma.receipt.create.mockResolvedValueOnce(makeRow());
      await store.mint(mintInput);

      expect(prisma.receipt.findFirst).not.toHaveBeenCalled();
      expect(prisma.receipt.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("promoteCalendarBookedToHeld", () => {
    it("promotes only booked calendar receipts for the org+booking and returns the count", async () => {
      prisma.receipt.updateMany.mockResolvedValueOnce({ count: 1 });
      const count = await store.promoteCalendarBookedToHeld("org-1", "bk-1");
      expect(prisma.receipt.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          bookingId: "bk-1",
          kind: "calendar",
          status: "booked",
        },
        data: { status: "held" },
      });
      expect(count).toBe(1);
    });

    it("returns 0 without throwing when no booked calendar receipt matches (best-effort, unlike recordAttendance)", async () => {
      prisma.receipt.updateMany.mockResolvedValueOnce({ count: 0 });
      const count = await store.promoteCalendarBookedToHeld("org-1", "no-receipt");
      expect(count).toBe(0);
    });
  });

  describe("countReceiptedBookingsInWindow", () => {
    it("counts DISTINCT bookings among org-scoped, non-void calendar receipts in [from, to)", async () => {
      const from = new Date("2026-06-08T00:00:00Z");
      const to = new Date("2026-06-15T00:00:00Z");
      // Two distinct bookings (a confirm-retry dupe for bk-1 would still be one distinct row here).
      prisma.receipt.findMany.mockResolvedValueOnce([{ bookingId: "bk-1" }, { bookingId: "bk-2" }]);

      const count = await store.countReceiptedBookingsInWindow({ orgId: "org-1", from, to });

      expect(prisma.receipt.findMany).toHaveBeenCalledWith({
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
      expect(count).toBe(2);
    });

    it("dedupes by bookingId so a confirm-retry double-mint counts once (distinct rows = the count)", async () => {
      // Prisma's distinct returns one row per bookingId; the store returns the row count.
      prisma.receipt.findMany.mockResolvedValueOnce([{ bookingId: "bk-1" }]);
      const count = await store.countReceiptedBookingsInWindow({
        orgId: "org-1",
        from: new Date("2026-06-08T00:00:00Z"),
        to: new Date("2026-06-15T00:00:00Z"),
      });
      expect(count).toBe(1);
    });

    it("returns 0 when no calendar receipts fall in the window", async () => {
      prisma.receipt.findMany.mockResolvedValueOnce([]);
      const count = await store.countReceiptedBookingsInWindow({
        orgId: "org-1",
        from: new Date("2026-06-08T00:00:00Z"),
        to: new Date("2026-06-15T00:00:00Z"),
      });
      expect(count).toBe(0);
    });
  });
});
