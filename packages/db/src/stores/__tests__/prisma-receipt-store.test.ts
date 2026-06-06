import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaReceiptStore } from "../prisma-receipt-store.js";

const now = new Date("2026-06-06T12:00:00Z");

function makeMockPrisma() {
  return {
    receipt: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
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
});
