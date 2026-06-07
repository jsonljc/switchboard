import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRevenueStore } from "../prisma-revenue-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    lifecycleRevenueEvent: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: { id: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    conversionRecord: { findMany: vi.fn().mockResolvedValue([]) },
    receipt: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function makeRevenueEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    organizationId: "org-1",
    contactId: "contact-1",
    opportunityId: "opp-1",
    amount: 2000,
    currency: "SGD",
    type: "payment",
    status: "confirmed",
    recordedBy: "stripe",
    externalReference: "pi_abc123",
    bookingId: null,
    verified: true,
    sourceCampaignId: "camp-1",
    sourceAdId: "ad-1",
    recordedAt: now,
    createdAt: now,
    ...overrides,
  };
}

describe("PrismaRevenueStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaRevenueStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaRevenueStore(prisma as never);
  });

  describe("record — tx threading", () => {
    it("uses tx client instead of this.prisma when tx is provided", async () => {
      const txClient = {
        lifecycleRevenueEvent: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(makeRevenueEvent({ externalReference: null })),
        },
      };
      const result = await store.record(
        {
          organizationId: "org-1",
          contactId: "contact-1",
          opportunityId: "opp-1",
          amount: 1000,
          type: "payment",
          recordedBy: "owner",
        },
        txClient as never,
      );
      expect(txClient.lifecycleRevenueEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.lifecycleRevenueEvent.create).not.toHaveBeenCalled();
      expect(result.amount).toBe(2000); // makeRevenueEvent default
    });

    it("falls back to this.prisma when no tx is provided", async () => {
      prisma.lifecycleRevenueEvent.create.mockResolvedValue(makeRevenueEvent({}));
      await store.record({
        organizationId: "org-1",
        contactId: "contact-1",
        opportunityId: "opp-1",
        amount: 1000,
        type: "payment",
        recordedBy: "owner",
      });
      expect(prisma.lifecycleRevenueEvent.create).toHaveBeenCalledTimes(1);
    });

    it("uses tx client for idempotency findFirst when externalReference is provided", async () => {
      const existingEvent = makeRevenueEvent({ externalReference: "pi_existing" });
      const txClient = {
        lifecycleRevenueEvent: {
          findFirst: vi.fn().mockResolvedValue(existingEvent),
          create: vi.fn(),
        },
      };
      const result = await store.record(
        {
          organizationId: "org-1",
          contactId: "contact-1",
          opportunityId: "opp-1",
          amount: 1000,
          type: "payment",
          recordedBy: "owner",
          externalReference: "pi_existing",
        },
        txClient as never,
      );
      expect(txClient.lifecycleRevenueEvent.findFirst).toHaveBeenCalledTimes(1);
      // Axis MUST match the DB partial-unique: (organizationId, externalReference) — not opportunityId
      expect(txClient.lifecycleRevenueEvent.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          externalReference: "pi_existing",
        },
      });
      expect(txClient.lifecycleRevenueEvent.create).not.toHaveBeenCalled();
      expect(prisma.lifecycleRevenueEvent.findFirst).not.toHaveBeenCalled();
      expect(result.externalReference).toBe("pi_existing"); // returned by the tx mock findFirst
    });
  });

  describe("record", () => {
    it("forwards bookingId into create data and round-trips it", async () => {
      const created = makeRevenueEvent({ bookingId: "book-1" });
      prisma.lifecycleRevenueEvent.create.mockResolvedValue(created);

      const result = await store.record({
        organizationId: "org-1",
        contactId: "contact-1",
        opportunityId: "opp-1",
        amount: 5000,
        type: "deposit",
        recordedBy: "stripe",
        verified: true,
        bookingId: "book-1",
      });

      expect(prisma.lifecycleRevenueEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ bookingId: "book-1" }),
      });
      expect(result.bookingId).toBe("book-1");
    });

    it("records a new revenue event with all fields", async () => {
      const input = {
        organizationId: "org-1",
        contactId: "contact-1",
        opportunityId: "opp-1",
        amount: 3000,
        currency: "USD",
        type: "payment" as const,
        status: "confirmed" as const,
        recordedBy: "stripe" as const,
        externalReference: "pi_xyz789",
        verified: true,
        sourceCampaignId: "camp-1",
        sourceAdId: "ad-1",
      };

      const created = makeRevenueEvent({
        amount: 3000,
        currency: "USD",
        externalReference: "pi_xyz789",
      });
      prisma.lifecycleRevenueEvent.create.mockResolvedValue(created);

      const result = await store.record(input);

      expect(prisma.lifecycleRevenueEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          organizationId: "org-1",
          contactId: "contact-1",
          opportunityId: "opp-1",
          amount: 3000,
          currency: "USD",
          type: "payment",
          status: "confirmed",
          recordedBy: "stripe",
          externalReference: "pi_xyz789",
          verified: true,
          sourceCampaignId: "camp-1",
          sourceAdId: "ad-1",
          recordedAt: expect.any(Date),
          createdAt: expect.any(Date),
        }),
      });

      expect(result.amount).toBe(3000);
      expect(result.currency).toBe("USD");
    });

    it("records revenue with defaults", async () => {
      const input = {
        organizationId: "org-1",
        contactId: "contact-1",
        opportunityId: "opp-1",
        amount: 1500,
        type: "deposit" as const,
        recordedBy: "owner" as const,
      };

      const created = makeRevenueEvent({
        amount: 1500,
        type: "deposit",
        currency: "SGD",
        status: "confirmed",
        verified: false,
      });
      prisma.lifecycleRevenueEvent.create.mockResolvedValue(created);

      await store.record(input);

      expect(prisma.lifecycleRevenueEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          currency: "SGD",
          status: "confirmed",
          externalReference: null,
          verified: false,
          sourceCampaignId: null,
          sourceAdId: null,
        }),
      });
    });
  });

  describe("findByOpportunity", () => {
    it("returns all revenue events for an opportunity", async () => {
      const events = [
        makeRevenueEvent({ id: "rev-1", amount: 1000 }),
        makeRevenueEvent({ id: "rev-2", amount: 2000 }),
      ];
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue(events);

      const result = await store.findByOpportunity("org-1", "opp-1");

      expect(prisma.lifecycleRevenueEvent.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          opportunityId: "opp-1",
        },
        orderBy: { recordedAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.amount).toBe(1000);
      expect(result[1]!.amount).toBe(2000);
    });

    it("returns empty array when no events exist", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([]);

      const result = await store.findByOpportunity("org-1", "opp-999");

      expect(result).toEqual([]);
    });
  });

  describe("findByContact", () => {
    it("scopes to organizationId AND contactId in the where clause", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([]);

      await store.findByContact("org-1", "c-1");

      expect(prisma.lifecycleRevenueEvent.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", contactId: "c-1" },
        orderBy: { recordedAt: "desc" },
      });
    });

    it("returns the rows mapped from prisma format", async () => {
      const row = makeRevenueEvent({ id: "r-1", contactId: "c-1", amount: 1200, currency: "SGD" });
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([row]);

      const result = await store.findByContact("org-1", "c-1");

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("r-1");
      expect(result[0]?.amount).toBe(1200);
    });

    it("returns [] when no rows match", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([]);

      expect(await store.findByContact("org-1", "c-1")).toEqual([]);
    });
  });

  describe("sumByOrg", () => {
    it("aggregates confirmed revenue without date range", async () => {
      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: 50000 },
        _count: { id: 10 },
      });

      const result = await store.sumByOrg("org-1");

      expect(prisma.lifecycleRevenueEvent.aggregate).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          status: "confirmed",
        },
        _sum: {
          amount: true,
        },
        _count: {
          id: true,
        },
      });

      expect(result).toEqual({
        totalAmount: 50000,
        count: 10,
      });
    });

    it("aggregates confirmed revenue with date range", async () => {
      const dateRange = {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-03-31T23:59:59Z"),
      };

      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: 25000 },
        _count: { id: 5 },
      });

      const result = await store.sumByOrg("org-1", dateRange);

      expect(prisma.lifecycleRevenueEvent.aggregate).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          status: "confirmed",
          recordedAt: {
            gte: dateRange.from,
            lte: dateRange.to,
          },
        },
        _sum: {
          amount: true,
        },
        _count: {
          id: true,
        },
      });

      expect(result).toEqual({
        totalAmount: 25000,
        count: 5,
      });
    });

    it("handles null sum", async () => {
      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: null },
        _count: { id: 0 },
      });

      const result = await store.sumByOrg("org-1");

      expect(result).toEqual({
        totalAmount: 0,
        count: 0,
      });
    });
  });

  describe("paidVisitsByCampaign", () => {
    const FROM = new Date("2026-06-01T00:00:00Z");
    const TO = new Date("2026-06-30T23:59:59Z");

    function paidEvent(overrides: Record<string, unknown> = {}) {
      return makeRevenueEvent({
        type: "deposit",
        status: "confirmed",
        verified: true,
        amount: 50000, // cents
        bookingId: "bk-1",
        origin: "live",
        ...overrides,
      });
    }

    it("returns one row per verified paid visit, scoped to organizationId + verified:true", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
        paidEvent({ id: "r1", bookingId: "bk-1" }),
        paidEvent({ id: "r2", bookingId: "bk-2", amount: 12000 }),
      ]);
      prisma.conversionRecord.findMany.mockResolvedValue([
        { bookingId: "bk-1", sourceCampaignId: "camp-1" },
        { bookingId: "bk-2", sourceCampaignId: "camp-2" },
      ]);
      prisma.receipt.findMany.mockResolvedValue([
        { bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" },
        { bookingId: "bk-2", provider: "stripe", tier: "T1_FETCH_BACK" },
      ]);

      const rows = await store.paidVisitsByCampaign({
        orgId: "org-1",
        from: FROM,
        to: TO,
        isProduction: true,
      });

      expect(rows).toHaveLength(2);
      const where = prisma.lifecycleRevenueEvent.findMany.mock.calls[0]![0].where;
      expect(where.organizationId).toBe("org-1");
      expect(where.verified).toBe(true);
    });

    it("returns CENTS (no division): a 50000-cent event yields amountCents 50000", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
        paidEvent({ id: "r1", amount: 50000 }),
      ]);
      prisma.conversionRecord.findMany.mockResolvedValue([
        { bookingId: "bk-1", sourceCampaignId: "camp-1" },
      ]);
      prisma.receipt.findMany.mockResolvedValue([
        { bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" },
      ]);

      const rows = await store.paidVisitsByCampaign({
        orgId: "org-1",
        from: FROM,
        to: TO,
        isProduction: true,
      });
      expect(rows[0]!.amountCents).toBe(50000);
    });

    it("in production, EXCLUDES a Noop payment and a non-live row; keeps the real T1 live row", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
        paidEvent({ id: "good", bookingId: "bk-good", origin: "live" }),
        paidEvent({ id: "noop", bookingId: "bk-noop", origin: "live" }),
        paidEvent({ id: "seed", bookingId: "bk-seed", origin: "seed" }),
      ]);
      prisma.conversionRecord.findMany.mockResolvedValue([
        { bookingId: "bk-good", sourceCampaignId: "camp-1" },
        { bookingId: "bk-noop", sourceCampaignId: "camp-1" },
        { bookingId: "bk-seed", sourceCampaignId: "camp-1" },
      ]);
      prisma.receipt.findMany.mockResolvedValue([
        { bookingId: "bk-good", provider: "stripe", tier: "T1_FETCH_BACK" },
        { bookingId: "bk-noop", provider: "noop", tier: "T3_ADMIN_AUDIT" },
        { bookingId: "bk-seed", provider: "stripe", tier: "T1_FETCH_BACK" },
      ]);

      const rows = await store.paidVisitsByCampaign({
        orgId: "org-1",
        from: FROM,
        to: TO,
        isProduction: true,
      });
      // origin filter is applied IN the prisma WHERE in prod:
      const where = prisma.lifecycleRevenueEvent.findMany.mock.calls[0]![0].where;
      expect(where.origin).toBe("live");
      // and the noop-provider row is dropped post-join:
      expect(rows.map((r) => r.bookingId)).toEqual(["bk-good"]);
    });

    it("outside production, keeps verified rows regardless of provider/origin (local exercise)", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
        paidEvent({ id: "noop", bookingId: "bk-noop", origin: "demo" }),
      ]);
      prisma.conversionRecord.findMany.mockResolvedValue([
        { bookingId: "bk-noop", sourceCampaignId: "camp-1" },
      ]);
      prisma.receipt.findMany.mockResolvedValue([
        { bookingId: "bk-noop", provider: "noop", tier: "T3_ADMIN_AUDIT" },
      ]);

      const rows = await store.paidVisitsByCampaign({
        orgId: "org-1",
        from: FROM,
        to: TO,
        isProduction: false,
      });
      const where = prisma.lifecycleRevenueEvent.findMany.mock.calls[0]![0].where;
      expect(where.origin).toBeUndefined(); // no origin filter outside prod
      expect(rows).toHaveLength(1);
    });

    it("derives attributionBasis: ctwa_captured with a campaign, campaign_missing without", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
        paidEvent({ id: "r1", bookingId: "bk-1" }),
        paidEvent({ id: "r2", bookingId: "bk-2" }),
      ]);
      prisma.conversionRecord.findMany.mockResolvedValue([
        { bookingId: "bk-1", sourceCampaignId: "camp-1" },
        { bookingId: "bk-2", sourceCampaignId: null },
      ]);
      prisma.receipt.findMany.mockResolvedValue([
        { bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" },
        { bookingId: "bk-2", provider: "stripe", tier: "T1_FETCH_BACK" },
      ]);

      const rows = await store.paidVisitsByCampaign({
        orgId: "org-1",
        from: FROM,
        to: TO,
        isProduction: true,
      });
      const byBooking = Object.fromEntries(rows.map((r) => [r.bookingId, r]));
      expect(byBooking["bk-1"]!.attributionBasis).toBe("ctwa_captured");
      expect(byBooking["bk-1"]!.sourceCampaignId).toBe("camp-1");
      expect(byBooking["bk-2"]!.attributionBasis).toBe("campaign_missing");
      expect(byBooking["bk-2"]!.sourceCampaignId).toBeNull();
    });

    it("scopes the ConversionRecord join by organizationId too", async () => {
      prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
        paidEvent({ id: "r1", bookingId: "bk-1" }),
      ]);
      prisma.conversionRecord.findMany.mockResolvedValue([
        { bookingId: "bk-1", sourceCampaignId: "camp-1" },
      ]);
      prisma.receipt.findMany.mockResolvedValue([
        { bookingId: "bk-1", provider: "stripe", tier: "T1_FETCH_BACK" },
      ]);

      await store.paidVisitsByCampaign({ orgId: "org-1", from: FROM, to: TO, isProduction: true });
      expect(prisma.conversionRecord.findMany.mock.calls[0]![0].where.organizationId).toBe("org-1");
      expect(prisma.receipt.findMany.mock.calls[0]![0].where.organizationId).toBe("org-1");
    });
  });

  describe("sumByCampaign", () => {
    it("sumByCampaign filters to origin 'live' (excludes seed/demo revenue from the owner read)", async () => {
      const groupBy = prisma.lifecycleRevenueEvent.groupBy as ReturnType<typeof vi.fn>;
      groupBy.mockResolvedValue([]);
      await store.sumByCampaign("org-1");
      expect(groupBy.mock.calls[0]![0].where.origin).toBe("live");
    });

    it("groups revenue by campaign without date range", async () => {
      prisma.lifecycleRevenueEvent.groupBy.mockResolvedValue([
        { sourceCampaignId: "camp-1", _sum: { amount: 30000 }, _count: { id: 6 } },
        { sourceCampaignId: "camp-2", _sum: { amount: 20000 }, _count: { id: 4 } },
      ]);

      const result = await store.sumByCampaign("org-1");

      expect(prisma.lifecycleRevenueEvent.groupBy).toHaveBeenCalledWith({
        by: ["sourceCampaignId"],
        where: {
          organizationId: "org-1",
          status: "confirmed",
          origin: "live",
          sourceCampaignId: {
            not: null,
          },
        },
        _sum: {
          amount: true,
        },
        _count: {
          id: true,
        },
      });

      expect(result).toHaveLength(2);
      expect(result[0]!).toEqual({
        sourceCampaignId: "camp-1",
        totalAmount: 30000,
        count: 6,
      });
      expect(result[1]!).toEqual({
        sourceCampaignId: "camp-2",
        totalAmount: 20000,
        count: 4,
      });
    });

    it("groups revenue by campaign with date range", async () => {
      const dateRange = {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-03-31T23:59:59Z"),
      };

      prisma.lifecycleRevenueEvent.groupBy.mockResolvedValue([
        { sourceCampaignId: "camp-1", _sum: { amount: 15000 }, _count: { id: 3 } },
      ]);

      const result = await store.sumByCampaign("org-1", dateRange);

      expect(prisma.lifecycleRevenueEvent.groupBy).toHaveBeenCalledWith({
        by: ["sourceCampaignId"],
        where: {
          organizationId: "org-1",
          status: "confirmed",
          origin: "live",
          sourceCampaignId: {
            not: null,
          },
          recordedAt: {
            gte: dateRange.from,
            lte: dateRange.to,
          },
        },
        _sum: {
          amount: true,
        },
        _count: {
          id: true,
        },
      });

      expect(result).toHaveLength(1);
    });

    it("filters out null campaign IDs", async () => {
      prisma.lifecycleRevenueEvent.groupBy.mockResolvedValue([
        { sourceCampaignId: "camp-1", _sum: { amount: 10000 }, _count: { id: 2 } },
        { sourceCampaignId: null, _sum: { amount: 5000 }, _count: { id: 1 } },
      ]);

      const result = await store.sumByCampaign("org-1");

      expect(result).toHaveLength(1);
      expect(result[0]!.sourceCampaignId).toBe("camp-1");
    });

    it("handles null amount sum", async () => {
      prisma.lifecycleRevenueEvent.groupBy.mockResolvedValue([
        { sourceCampaignId: "camp-1", _sum: { amount: null }, _count: { id: 0 } },
      ]);

      const result = await store.sumByCampaign("org-1");

      expect(result[0]!.totalAmount).toBe(0);
    });
  });
});
