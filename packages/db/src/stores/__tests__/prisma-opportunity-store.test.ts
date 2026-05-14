import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOpportunityStore } from "../prisma-opportunity-store.js";
import type { PrismaDbClient } from "../../prisma-db.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    opportunity: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    lifecycleRevenueEvent: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
  };
}

function mkPrismaMock() {
  return {
    opportunity: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        opportunity: { findFirst: vi.fn(), update: vi.fn() },
        workTrace: { create: vi.fn() },
      }),
    ),
  } as unknown as PrismaDbClient;
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
    store = new PrismaOpportunityStore(prisma as never, null);
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
    it("updates opportunity stage without closedAt", async () => {
      const existing = makeOpportunity();
      prisma.opportunity.findFirst.mockResolvedValue(existing);
      const updated = makeOpportunity({ stage: "qualified" });
      prisma.opportunity.update.mockResolvedValue(updated);

      const result = await store.updateStage("org-1", "opp-1", "qualified");

      expect(prisma.opportunity.findFirst).toHaveBeenCalledWith({
        where: { id: "opp-1", organizationId: "org-1" },
      });
      expect(prisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: "opp-1" },
        data: {
          stage: "qualified",
          closedAt: undefined,
          updatedAt: expect.any(Date),
        },
      });
      expect(result.stage).toBe("qualified");
    });

    it("updates opportunity stage with closedAt", async () => {
      const existing = makeOpportunity();
      prisma.opportunity.findFirst.mockResolvedValue(existing);
      const closedDate = new Date("2026-03-25T15:00:00Z");
      const updated = makeOpportunity({ stage: "won", closedAt: closedDate });
      prisma.opportunity.update.mockResolvedValue(updated);

      const result = await store.updateStage("org-1", "opp-1", "won", closedDate);

      expect(prisma.opportunity.findFirst).toHaveBeenCalledWith({
        where: { id: "opp-1", organizationId: "org-1" },
      });
      expect(prisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: "opp-1" },
        data: {
          stage: "won",
          closedAt: closedDate,
          updatedAt: expect.any(Date),
        },
      });
      expect(result.stage).toBe("won");
      expect(result.closedAt).toEqual(closedDate);
    });

    it("throws when opportunity not found or wrong org", async () => {
      prisma.opportunity.findFirst.mockResolvedValue(null);

      await expect(store.updateStage("org-1", "opp-999", "qualified")).rejects.toThrow(
        /not found or does not belong/,
      );
    });
  });

  describe("updateRevenueTotal", () => {
    it("aggregates confirmed revenue and updates opportunity", async () => {
      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: 5000 },
      });

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

      expect(prisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: "opp-1" },
        data: {
          revenueTotal: 5000,
          updatedAt: expect.any(Date),
        },
      });
    });

    it("handles null revenue sum", async () => {
      prisma.lifecycleRevenueEvent.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });

      await store.updateRevenueTotal("org-1", "opp-1");

      expect(prisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: "opp-1" },
        data: {
          revenueTotal: 0,
          updatedAt: expect.any(Date),
        },
      });
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
});

describe("PrismaOpportunityStore.findOrgBoard", () => {
  it("filters by organizationId and includes the contact projection", async () => {
    const prisma = mkPrismaMock();
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const store = new PrismaOpportunityStore(prisma, null);
    await store.findOrgBoard("org_acme");
    const call = (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({ organizationId: "org_acme" });
    expect(call.include).toEqual({
      contact: { select: { id: true, name: true, primaryChannel: true } },
    });
    expect(call.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("maps rows to OpportunityBoardRow shape with Date fields preserved", async () => {
    const prisma = mkPrismaMock();
    const opened = new Date("2026-05-06T05:00:00Z");
    const updated = new Date("2026-05-13T07:19:00Z");
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "opp_1",
        organizationId: "org_acme",
        contactId: "c_1",
        serviceId: "svc",
        serviceName: "Service",
        stage: "quoted",
        timeline: "soon",
        priceReadiness: "flexible",
        objections: [],
        qualificationComplete: true,
        estimatedValue: 168000,
        revenueTotal: 0,
        assignedAgent: "alex",
        assignedStaff: null,
        lostReason: null,
        notes: null,
        openedAt: opened,
        closedAt: null,
        updatedAt: updated,
        contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
      },
    ]);
    const store = new PrismaOpportunityStore(prisma, null);
    const rows = await store.findOrgBoard("org_acme");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("opp_1");
    expect(rows[0]!.openedAt).toBeInstanceOf(Date);
    expect(rows[0]!.openedAt.toISOString()).toBe("2026-05-06T05:00:00.000Z");
    expect(rows[0]!.contact.name).toBe("Felicia");
  });

  it("returns [] for an org with no rows", async () => {
    const prisma = mkPrismaMock();
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const store = new PrismaOpportunityStore(prisma, null);
    const rows = await store.findOrgBoard("org_empty");
    expect(rows).toEqual([]);
  });
});
