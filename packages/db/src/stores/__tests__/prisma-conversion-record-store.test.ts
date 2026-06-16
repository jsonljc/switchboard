import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversionRecordStore } from "../prisma-conversion-record-store.js";

function makePrisma() {
  return {
    conversionRecord: {
      upsert: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
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

  it("defaults origin to 'live' on create when omitted", async () => {
    const upsertMock = prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>;
    upsertMock.mockResolvedValue({ id: "cr_o1" });
    await store.record({
      eventId: "evt-o1",
      organizationId: "org-1",
      contactId: "ct-1",
      type: "booked",
      value: 100,
      occurredAt: new Date("2026-05-14T10:00:00Z"),
      source: "calendar-book",
      metadata: {},
    });
    expect(upsertMock.mock.calls[0]![0].create.origin).toBe("live");
  });

  it("passes an explicit origin through to create (seed/demo provenance)", async () => {
    const upsertMock = prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>;
    upsertMock.mockResolvedValue({ id: "cr_o2" });
    await store.record({
      eventId: "evt-o2",
      organizationId: "org-1",
      contactId: "ct-1",
      type: "booked",
      value: 100,
      occurredAt: new Date("2026-05-14T10:00:00Z"),
      source: "seed",
      metadata: {},
      origin: "seed",
    });
    expect(upsertMock.mock.calls[0]![0].create.origin).toBe("seed");
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

    it("filters to origin 'live' so seed/demo booked rows are excluded", async () => {
      const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
      groupBy.mockResolvedValue([]);
      await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
      expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
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
          origin: "live",
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

    it("filters to origin 'live'", async () => {
      const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
      groupBy.mockResolvedValue([]);
      await store.queryBookedStatsByCampaign({ orgId: "org_1", ...window });
      expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
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

  describe("getBookedStatsForOrgWindow (riley v3 slice 4d)", () => {
    it("aggregates valued bookings org-wide over the HALF-OPEN window (gte/lt, the engine's Meta-window convention)", async () => {
      (prisma.conversionRecord.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
        _sum: { value: 45000 },
        _count: { _all: 5 },
      });

      const result = await store.getBookedStatsForOrgWindow({
        organizationId: "org-1",
        startInclusive: new Date("2026-04-24T12:00:00Z"),
        endExclusive: new Date("2026-05-01T12:00:00Z"),
      });

      expect(prisma.conversionRecord.aggregate).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          type: "booked",
          value: { gt: 0 },
          occurredAt: {
            gte: new Date("2026-04-24T12:00:00Z"),
            lt: new Date("2026-05-01T12:00:00Z"),
          },
        },
        _sum: { value: true },
        _count: { _all: true },
      });
      // CENTS passthrough: the stored value is already cents; no conversion here.
      expect(result).toEqual({ bookedValueCents: 45000, bookedCount: 5 });
    });

    it("returns honest zeros for an org with no valued bookings in the window (fails the floors, never an error)", async () => {
      (prisma.conversionRecord.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
        _sum: { value: null },
        _count: { _all: 0 },
      });

      const result = await store.getBookedStatsForOrgWindow({
        organizationId: "org-1",
        startInclusive: new Date("2026-05-01T12:00:00Z"),
        endExclusive: new Date("2026-05-08T12:00:00Z"),
      });

      expect(result).toEqual({ bookedValueCents: 0, bookedCount: 0 });
    });

    it("satisfies @switchboard/core's OrgBookedStatsReader structurally (the DI seam)", () => {
      // Type-level pin: assignment compiles only while the method name and
      // shape match the core interface the bootstrap injects this store into.
      const reader: import("@switchboard/core").OrgBookedStatsReader = store;
      expect(typeof reader.getBookedStatsForOrgWindow).toBe("function");
    });
  });

  describe("countAdAttributedBookings (riley CAC denominator, D8-3)", () => {
    it("counts only booked+live records carrying ad attribution, scoped by org + closed window", async () => {
      const countMock = prisma.conversionRecord.count as ReturnType<typeof vi.fn>;
      countMock.mockResolvedValue(3);
      const from = new Date("2026-05-01T00:00:00.000Z");
      const to = new Date("2026-05-08T00:00:00.000Z");

      const result = await store.countAdAttributedBookings({ orgId: "org_1", from, to });

      expect(result).toBe(3);
      expect(countMock).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          type: "booked",
          origin: "live",
          occurredAt: { gte: from, lte: to },
          OR: [{ sourceCampaignId: { not: null } }, { sourceChannel: { not: null } }],
        },
      });
    });

    it("returns the raw count (organic/Alex bookings carry no source and cannot satisfy the predicate)", async () => {
      (prisma.conversionRecord.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
      await expect(
        store.countAdAttributedBookings({ orgId: "org_1", from: new Date(0), to: new Date(1) }),
      ).resolves.toBe(2);
    });
  });
});
