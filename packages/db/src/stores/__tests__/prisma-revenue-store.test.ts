import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRevenueStore } from "../prisma-revenue-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    lifecycleRevenueEvent: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: { id: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
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

  describe("record", () => {
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

  describe("sumByCampaign", () => {
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
