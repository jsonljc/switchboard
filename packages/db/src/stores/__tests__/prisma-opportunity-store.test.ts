import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOpportunityStore } from "../prisma-opportunity-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    opportunity: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    lifecycleRevenueEvent: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
  };
}

function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-1",
    organizationId: "org-1",
    contactId: "contact-1",
    serviceId: "service-1",
    serviceName: "Laser Hair Removal",
    stage: "interested",
    timeline: null,
    priceReadiness: null,
    objections: [],
    qualificationComplete: false,
    estimatedValue: 2000,
    revenueTotal: 0,
    assignedAgent: "employee-b",
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("PrismaOpportunityStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaOpportunityStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaOpportunityStore(prisma as never);
  });

  describe("create", () => {
    it("creates a new opportunity with all fields", async () => {
      const input = {
        organizationId: "org-1",
        contactId: "contact-1",
        serviceId: "service-1",
        serviceName: "Botox Treatment",
        estimatedValue: 1500,
        assignedAgent: "employee-a",
      };

      const created = makeOpportunity({
        serviceName: "Botox Treatment",
        estimatedValue: 1500,
      });
      prisma.opportunity.create.mockResolvedValue(created);

      const result = await store.create(input);

      expect(prisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          organizationId: "org-1",
          contactId: "contact-1",
          serviceId: "service-1",
          serviceName: "Botox Treatment",
          stage: "interested",
          estimatedValue: 1500,
          assignedAgent: "employee-a",
          objections: [],
          qualificationComplete: false,
          revenueTotal: 0,
          openedAt: expect.any(Date),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      });

      expect(result.stage).toBe("interested");
      expect(result.revenueTotal).toBe(0);
    });

    it("creates opportunity with minimal fields", async () => {
      const input = {
        organizationId: "org-1",
        contactId: "contact-1",
        serviceId: "service-2",
        serviceName: "Facial",
      };

      const created = makeOpportunity({
        estimatedValue: null,
        assignedAgent: null,
      });
      prisma.opportunity.create.mockResolvedValue(created);

      await store.create(input);

      expect(prisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          estimatedValue: null,
          assignedAgent: null,
        }),
      });
    });
  });

  describe("findById", () => {
    it("returns null when opportunity not found", async () => {
      const result = await store.findById("org-1", "opp-999");

      expect(result).toBeNull();
      expect(prisma.opportunity.findFirst).toHaveBeenCalledWith({
        where: {
          id: "opp-999",
          organizationId: "org-1",
        },
      });
    });

    it("returns opportunity when found", async () => {
      const opp = makeOpportunity();
      prisma.opportunity.findFirst.mockResolvedValue(opp);

      const result = await store.findById("org-1", "opp-1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("opp-1");
      expect(result!.serviceName).toBe("Laser Hair Removal");
      expect(result!.stage).toBe("interested");
    });

    it("parses objections from JSON", async () => {
      const opp = makeOpportunity({
        objections: [
          { category: "price", raisedAt: now, resolvedAt: null },
          { category: "timeline", raisedAt: now, resolvedAt: now },
        ],
      });
      prisma.opportunity.findFirst.mockResolvedValue(opp);

      const result = await store.findById("org-1", "opp-1");

      expect(result!.objections).toHaveLength(2);
      expect(result!.objections[0]!.category).toBe("price");
      expect(result!.objections[1]!.category).toBe("timeline");
    });
  });

  describe("findByContact", () => {
    it("returns all opportunities for a contact", async () => {
      const opps = [
        makeOpportunity({ id: "opp-1" }),
        makeOpportunity({ id: "opp-2", stage: "won" }),
      ];
      prisma.opportunity.findMany.mockResolvedValue(opps);

      const result = await store.findByContact("org-1", "contact-1");

      expect(prisma.opportunity.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          contactId: "contact-1",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("findActiveByContact", () => {
    it("excludes won and lost opportunities", async () => {
      const opps = [
        makeOpportunity({ id: "opp-1", stage: "qualified" }),
        makeOpportunity({ id: "opp-2", stage: "booked" }),
      ];
      prisma.opportunity.findMany.mockResolvedValue(opps);

      const result = await store.findActiveByContact("org-1", "contact-1");

      expect(prisma.opportunity.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          contactId: "contact-1",
          stage: {
            notIn: ["won", "lost"],
          },
        },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("updateStage", () => {
    it("calls updateMany with tenant-scoped WHERE and maps the read-back row", async () => {
      prisma.opportunity.updateMany.mockResolvedValue({ count: 1 });
      const updated = makeOpportunity({ stage: "qualified" });
      prisma.opportunity.findFirstOrThrow.mockResolvedValue(updated);

      const result = await store.updateStage("org-1", "opp-1", "qualified");

      expect(prisma.opportunity.updateMany).toHaveBeenCalledWith({
        where: { id: "opp-1", organizationId: "org-1" },
        data: {
          stage: "qualified",
          closedAt: undefined,
          updatedAt: expect.any(Date),
        },
      });
      expect(prisma.opportunity.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "opp-1", organizationId: "org-1" },
      });
      expect(result.stage).toBe("qualified");
    });

    it("passes closedAt through to updateMany data", async () => {
      const closedDate = new Date("2026-03-25T15:00:00Z");
      prisma.opportunity.updateMany.mockResolvedValue({ count: 1 });
      const updated = makeOpportunity({ stage: "won", closedAt: closedDate });
      prisma.opportunity.findFirstOrThrow.mockResolvedValue(updated);

      const result = await store.updateStage("org-1", "opp-1", "won", closedDate);

      expect(prisma.opportunity.updateMany).toHaveBeenCalledWith({
        where: { id: "opp-1", organizationId: "org-1" },
        data: {
          stage: "won",
          closedAt: closedDate,
          updatedAt: expect.any(Date),
        },
      });
      expect(result.stage).toBe("won");
      expect(result.closedAt).toEqual(closedDate);
    });

    it("throws StaleVersionError (matching /Stale version/) when count===0", async () => {
      prisma.opportunity.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateStage("org-1", "opp-999", "qualified")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("updateRevenueTotal", () => {
    it("aggregates confirmed revenue and calls updateMany with tenant-scoped WHERE", async () => {
      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: 5000 },
      });
      prisma.opportunity.updateMany.mockResolvedValue({ count: 1 });

      await store.updateRevenueTotal("org-1", "opp-1");

      expect(prisma.lifecycleRevenueEvent.aggregate).toHaveBeenCalledWith({
        where: {
          opportunityId: "opp-1",
          status: "confirmed",
        },
        _sum: {
          amount: true,
        },
      });

      expect(prisma.opportunity.updateMany).toHaveBeenCalledWith({
        where: { id: "opp-1", organizationId: "org-1" },
        data: {
          revenueTotal: 5000,
          updatedAt: expect.any(Date),
        },
      });
    });

    it("handles null revenue sum (uses 0)", async () => {
      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      prisma.opportunity.updateMany.mockResolvedValue({ count: 1 });

      await store.updateRevenueTotal("org-1", "opp-1");

      expect(prisma.opportunity.updateMany).toHaveBeenCalledWith({
        where: { id: "opp-1", organizationId: "org-1" },
        data: {
          revenueTotal: 0,
          updatedAt: expect.any(Date),
        },
      });
    });

    it("throws StaleVersionError (matching /Stale version/) when count===0", async () => {
      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: 100 },
      });
      prisma.opportunity.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateRevenueTotal("org-1", "opp-999")).rejects.toThrow(/Stale version/);
    });
  });

  describe("countByStage", () => {
    it("groups opportunities by stage", async () => {
      prisma.opportunity.groupBy.mockResolvedValue([
        { stage: "interested", _count: { id: 5 }, _sum: { estimatedValue: 10000 } },
        { stage: "qualified", _count: { id: 3 }, _sum: { estimatedValue: 7500 } },
        { stage: "won", _count: { id: 2 }, _sum: { estimatedValue: null } },
      ]);

      const result = (await store.countByStage("org-1")) as Array<{
        stage: string;
        count: number;
        totalValue: number;
      }>;

      expect(prisma.opportunity.groupBy).toHaveBeenCalledWith({
        by: ["stage"],
        where: {
          organizationId: "org-1",
        },
        _count: {
          id: true,
        },
        _sum: {
          estimatedValue: true,
        },
      });

      expect(result).toHaveLength(3);
      expect(result[0]!).toEqual({
        stage: "interested",
        count: 5,
        totalValue: 10000,
      });
      expect(result[1]!).toEqual({
        stage: "qualified",
        count: 3,
        totalValue: 7500,
      });
      expect(result[2]!).toEqual({
        stage: "won",
        count: 2,
        totalValue: 0,
      });
    });
  });

  describe("countCurrentlyAtStageUpdatedInWindow", () => {
    it("countCurrentlyAtStageUpdatedInWindow filters by stage + updatedAt window", async () => {
      const count = vi.fn(async () => 4);
      const store = new PrismaOpportunityStore({ opportunity: { count } } as never);
      const from = new Date("2026-05-04T00:00:00Z");
      const to = new Date("2026-05-11T00:00:00Z");
      const n = await store.countCurrentlyAtStageUpdatedInWindow({
        orgId: "org-1",
        stage: "showed",
        from,
        to,
      });
      expect(n).toBe(4);
      expect(count).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          stage: "showed",
          updatedAt: { gte: from, lt: to },
        },
      });
    });
  });

  describe("latestOpportunityStageUpdatedAt", () => {
    it("latestOpportunityStageUpdatedAt returns newest updatedAt or null", async () => {
      const findFirst = vi.fn(async () => ({ updatedAt: new Date("2026-05-06T00:00:00Z") }));
      const store = new PrismaOpportunityStore({ opportunity: { findFirst } } as never);
      const d = await store.latestOpportunityStageUpdatedAt({ orgId: "org-1", stage: "showed" });
      expect(d).toEqual(new Date("2026-05-06T00:00:00Z"));
      expect(findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", stage: "showed" },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      });
    });

    it("latestOpportunityStageUpdatedAt returns null when no matching row exists", async () => {
      const findFirst = vi.fn(async () => null);
      const store = new PrismaOpportunityStore({ opportunity: { findFirst } } as never);
      const d = await store.latestOpportunityStageUpdatedAt({ orgId: "org-1", stage: "showed" });
      expect(d).toBeNull();
    });
  });
});
