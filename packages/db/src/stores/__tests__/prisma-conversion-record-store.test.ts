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

  it("extracts bookingId from event.metadata into the indexed bookingId column", async () => {
    const upsertMock = prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>;
    upsertMock.mockResolvedValue({ id: "cr_bk_1" });

    await store.record({
      eventId: "evt-bk-1",
      organizationId: "org-1",
      contactId: "ct-1",
      type: "booked",
      value: 0,
      occurredAt: new Date("2026-05-14T10:00:00Z"),
      source: "outbox",
      metadata: { bookingId: "bk_42", note: "from calendar-book" },
    });

    expect(upsertMock.mock.calls[0]![0].create.bookingId).toBe("bk_42");
  });

  it("leaves bookingId null when metadata has no bookingId", async () => {
    const upsertMock = prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>;
    upsertMock.mockResolvedValue({ id: "cr_no_bk" });

    await store.record({
      eventId: "evt-no-bk",
      organizationId: "org-1",
      contactId: "ct-1",
      type: "qualified",
      value: 0,
      occurredAt: new Date("2026-05-14T10:00:00Z"),
      source: "outbox",
      metadata: { note: "no booking on this event" },
    });

    expect(upsertMock.mock.calls[0]![0].create.bookingId).toBeNull();
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

  describe("queryBookedValueCentsByCampaign", () => {
    const window = { from: new Date("2026-04-01"), to: new Date("2026-04-30") };

    it("sums booked value (cents) per campaign, preserving cents (no /100)", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { sourceCampaignId: "c1", _sum: { value: 12345 } },
        { sourceCampaignId: "c2", _sum: { value: 50000 } },
      ]);
      const result = await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
      expect(result.get("c1")).toBe(12345);
      expect(result.get("c2")).toBe(50000);
      expect(result.size).toBe(2);
    });

    it("filters to booked type, value>0, non-null campaign, and the window", async () => {
      const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
      groupBy.mockResolvedValue([]);
      await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
      const where = groupBy.mock.calls[0]![0].where;
      expect(where.type).toBe("booked");
      expect(where.value).toEqual({ gt: 0 });
      expect(where.sourceCampaignId).toEqual({ not: null });
      expect(where.occurredAt.gte).toBeInstanceOf(Date);
      expect(where.occurredAt.lte).toBeInstanceOf(Date);
    });

    it("scopes to campaignIds when provided", async () => {
      const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
      groupBy.mockResolvedValue([]);
      await store.queryBookedValueCentsByCampaign({
        orgId: "org_1",
        ...window,
        campaignIds: ["c1", "c2"],
      });
      expect(groupBy.mock.calls[0]![0].where.sourceCampaignId).toEqual({ in: ["c1", "c2"] });
    });

    it("omits campaigns with no attributed booked value — honest absence, not a fabricated 0", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { sourceCampaignId: "c1", _sum: { value: 0 } },
        { sourceCampaignId: null, _sum: { value: 999 } },
      ]);
      const result = await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
      expect(result.has("c1")).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  describe("queryBookedStatsByCampaign", () => {
    const window = {
      from: new Date("2026-05-01T00:00:00Z"),
      to: new Date("2026-06-04T00:00:00Z"),
    };

    it("aggregates sum AND count over the same value-positive booked predicate", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
        { sourceCampaignId: "camp_1", _sum: { value: 25000 }, _count: { _all: 2 } },
        { sourceCampaignId: null, _sum: { value: 100 }, _count: { _all: 1 } },
      ]);

      const out = await store.queryBookedStatsByCampaign({
        orgId: "org_1",
        ...window,
        campaignIds: ["camp_1"],
      });

      expect(prisma.conversionRecord.groupBy).toHaveBeenCalledWith({
        by: ["sourceCampaignId"],
        where: {
          organizationId: "org_1",
          type: "booked",
          value: { gt: 0 },
          occurredAt: { gte: window.from, lte: window.to },
          sourceCampaignId: { in: ["camp_1"] },
        },
        _sum: { value: true },
        _count: { _all: true },
      });
      expect(out.get("camp_1")).toEqual({ valueCents: 25000, count: 2 });
      expect(out.size).toBe(1); // null sourceCampaignId row dropped
    });

    it("omits the campaignIds filter (any non-null campaign) when not provided", async () => {
      (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await store.queryBookedStatsByCampaign({ orgId: "org_1", ...window });

      expect(prisma.conversionRecord.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceCampaignId: { not: null } }),
        }),
      );
    });
  });
});
