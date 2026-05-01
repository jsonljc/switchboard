import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversionRecordStore } from "../prisma-conversion-record-store.js";

function makePrisma() {
  return {
    conversionRecord: {
      upsert: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe("PrismaConversionRecordStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaConversionRecordStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaConversionRecordStore(prisma as never);
  });

  it("records a conversion event idempotently via upsert", async () => {
    (prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cr_1" });

    await store.record({
      eventId: "evt_1",
      type: "booked",
      contactId: "ct_1",
      organizationId: "org_1",
      value: 100,
      occurredAt: new Date("2026-04-20T10:00:00Z"),
      source: "calendar-book",
      metadata: {},
    });

    expect(prisma.conversionRecord.upsert).toHaveBeenCalledWith({
      where: { eventId: "evt_1" },
      create: expect.objectContaining({ eventId: "evt_1", type: "booked", value: 100 }),
      update: {},
    });
  });

  it("funnelByOrg aggregates counts by stage type", async () => {
    (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: "inquiry", _count: { _all: 10 }, _sum: { value: 0 } },
      { type: "qualified", _count: { _all: 7 }, _sum: { value: 0 } },
      { type: "booked", _count: { _all: 3 }, _sum: { value: 300 } },
    ]);

    const dateRange = { from: new Date("2026-04-01"), to: new Date("2026-04-30") };
    const funnel = await store.funnelByOrg("org_1", dateRange);

    expect(funnel.inquiry).toBe(10);
    expect(funnel.qualified).toBe(7);
    expect(funnel.booked).toBe(3);
    expect(funnel.totalRevenue).toBe(300);
    expect(funnel.purchased).toBe(0);
  });

  describe("activePipelineCounts", () => {
    it("returns counts per stage with 30-day window for terminal states", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { type: "inquiry", _count: { _all: 12 } },
        { type: "qualified", _count: { _all: 8 } },
        { type: "booked", _count: { _all: 5 } },
        { type: "purchased", _count: { _all: 3 } },
        { type: "completed", _count: { _all: 2 } },
      ]);

      const result = await store.activePipelineCounts("org-1");

      expect(result).toEqual({
        inquiry: 12,
        qualified: 8,
        booked: 5,
        purchased: 3,
        completed: 2,
      });
    });

    it("returns zeros for missing stages", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { type: "inquiry", _count: { _all: 3 } },
      ]);

      const result = await store.activePipelineCounts("org-1");

      expect(result).toEqual({
        inquiry: 3,
        qualified: 0,
        booked: 0,
        purchased: 0,
        completed: 0,
      });
    });

    it("applies 30-day filter for terminal stages", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await store.activePipelineCounts("org-1");

      const call = (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.where.OR).toBeDefined();
      expect(call.where.OR).toHaveLength(2);
      // First condition: active stages (not in terminal)
      expect(call.where.OR![0].type.notIn).toContain("completed");
      expect(call.where.OR![0].type.notIn).toContain("lost");
      // Second condition: terminal stages within 30 days
      expect(call.where.OR![1].type.in).toContain("completed");
      expect(call.where.OR[1].occurredAt.gte).toBeInstanceOf(Date);
    });
  });

  describe("alexStatsToday", () => {
    it("alexStatsToday returns counts of replies, qualified leads, and bookings created today", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { type: "inquiry", _count: { _all: 3 } },
        { type: "qualified", _count: { _all: 1 } },
        { type: "booked", _count: { _all: 1 } },
      ]);

      const stats = await store.alexStatsToday("org-alex", new Date());
      expect(stats).toEqual({ repliedToday: 3, qualifiedToday: 1, bookedToday: 1 });
    });

    it("alexStatsToday returns zeros for an empty org", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const stats = await store.alexStatsToday("org-empty", new Date());
      expect(stats).toEqual({ repliedToday: 0, qualifiedToday: 0, bookedToday: 0 });
    });
  });
});
