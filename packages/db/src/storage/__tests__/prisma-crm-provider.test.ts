import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCrmProvider } from "../prisma-crm-provider.js";

function createMockPrisma() {
  return {
    crmContact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    crmDeal: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    crmActivity: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
}

const TEST_CONTACT = {
  id: "contact_1",
  externalId: null,
  channel: "email",
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Johnson",
  company: "Acme",
  phone: null,
  tags: ["vip"],
  status: "active",
  organizationId: "org_1",
  properties: {},
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const TEST_DEAL = {
  id: "deal_1",
  name: "Big Deal",
  stage: "qualified",
  pipeline: "default",
  amount: 5000,
  closeDate: null,
  contactId: "contact_1",
  organizationId: "org_1",
  properties: {},
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

describe("PrismaCrmProvider", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let provider: PrismaCrmProvider;

  beforeEach(() => {
    prisma = createMockPrisma();
    provider = new PrismaCrmProvider(prisma as any, "org_1");
  });

  describe("contacts", () => {
    it("searches contacts by query", async () => {
      prisma.crmContact.findMany.mockResolvedValue([TEST_CONTACT]);
      const results = await provider.searchContacts("alice");
      expect(results).toHaveLength(1);
      expect(results[0]!.email).toBe("alice@example.com");
    });

    it("gets a contact by id with org filter", async () => {
      prisma.crmContact.findFirst.mockResolvedValue(TEST_CONTACT);
      const result = await provider.getContact("contact_1");
      expect(result).not.toBeNull();
      expect(result!.firstName).toBe("Alice");
      expect(prisma.crmContact.findFirst).toHaveBeenCalledWith({
        where: { id: "contact_1", organizationId: "org_1" },
      });
    });

    it("returns null for contact in different org", async () => {
      prisma.crmContact.findFirst.mockResolvedValue(null);
      const result = await provider.getContact("contact_other_org");
      expect(result).toBeNull();
    });

    it("creates a contact", async () => {
      prisma.crmContact.create.mockResolvedValue(TEST_CONTACT);
      const result = await provider.createContact({
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Johnson",
      });
      expect(result.email).toBe("alice@example.com");
      expect(prisma.crmContact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: "alice@example.com", organizationId: "org_1" }),
        }),
      );
    });

    it("updates a contact after verifying org ownership", async () => {
      prisma.crmContact.findFirst.mockResolvedValue({ id: "contact_1" });
      prisma.crmContact.update.mockResolvedValue({ ...TEST_CONTACT, company: "NewCo" });
      const result = await provider.updateContact("contact_1", { company: "NewCo" });
      expect(result.company).toBe("NewCo");
      expect(prisma.crmContact.findFirst).toHaveBeenCalledWith({
        where: { id: "contact_1", organizationId: "org_1" },
        select: { id: true },
      });
    });

    it("rejects update for contact in different org", async () => {
      prisma.crmContact.findFirst.mockResolvedValue(null);
      await expect(provider.updateContact("contact_other", { company: "X" })).rejects.toThrow(
        "not found",
      );
      expect(prisma.crmContact.update).not.toHaveBeenCalled();
    });

    it("archives a contact after verifying org ownership", async () => {
      prisma.crmContact.findFirst.mockResolvedValue({ id: "contact_1" });
      prisma.crmContact.update.mockResolvedValue({});
      await provider.archiveContact("contact_1");
      expect(prisma.crmContact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "contact_1" },
          data: { status: "archived" },
        }),
      );
    });

    it("rejects archive for contact in different org", async () => {
      prisma.crmContact.findFirst.mockResolvedValue(null);
      await expect(provider.archiveContact("contact_other")).rejects.toThrow("not found");
      expect(prisma.crmContact.update).not.toHaveBeenCalled();
    });
  });

  describe("deals", () => {
    it("lists deals with filters", async () => {
      prisma.crmDeal.findMany.mockResolvedValue([TEST_DEAL]);
      const results = await provider.listDeals({ pipeline: "default" });
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("Big Deal");
    });

    it("creates a deal linked to contact", async () => {
      prisma.crmDeal.create.mockResolvedValue(TEST_DEAL);
      const result = await provider.createDeal({
        name: "Big Deal",
        amount: 5000,
        contactIds: ["contact_1"],
      });
      expect(result.name).toBe("Big Deal");
      expect(result.contactIds).toContain("contact_1");
    });

    it("rejects archive for deal in different org", async () => {
      prisma.crmDeal.findFirst.mockResolvedValue(null);
      await expect(provider.archiveDeal("deal_other")).rejects.toThrow("not found");
      expect(prisma.crmDeal.update).not.toHaveBeenCalled();
    });

    it("gets pipeline aggregation", async () => {
      prisma.crmDeal.groupBy.mockResolvedValue([
        { stage: "lead", _count: { id: 3 }, _sum: { amount: 15000 } },
        { stage: "qualified", _count: { id: 2 }, _sum: { amount: 10000 } },
        { stage: "closed_won", _count: { id: 1 }, _sum: { amount: 5000 } },
      ]);

      const stages = await provider.getPipelineStatus();
      expect(stages).toHaveLength(3);
      expect(stages[0]!.id).toBe("lead");
      expect(stages[0]!.dealCount).toBe(3);
      expect(stages[1]!.id).toBe("qualified");
      expect(stages[2]!.id).toBe("closed_won");
    });
  });

  describe("activities", () => {
    it("lists activities", async () => {
      const activity = {
        id: "act_1",
        type: "note",
        subject: "Follow up",
        body: "Called about deal",
        contactId: "contact_1",
        dealId: null,
        organizationId: "org_1",
        createdAt: new Date("2025-01-01"),
      };
      prisma.crmActivity.findMany.mockResolvedValue([activity]);
      const results = await provider.listActivities({ contactId: "contact_1" });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe("note");
    });

    it("logs an activity", async () => {
      const activity = {
        id: "act_2",
        type: "call",
        subject: "Sales call",
        body: "Discussed pricing",
        contactId: "contact_1",
        dealId: "deal_1",
        organizationId: "org_1",
        createdAt: new Date("2025-01-01"),
      };
      prisma.crmActivity.create.mockResolvedValue(activity);
      const result = await provider.logActivity({
        type: "call",
        subject: "Sales call",
        body: "Discussed pricing",
        contactIds: ["contact_1"],
        dealIds: ["deal_1"],
      });
      expect(result.type).toBe("call");
    });
  });

  describe("health", () => {
    it("returns connected when DB is reachable", async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
      const health = await provider.healthCheck();
      expect(health.status).toBe("connected");
    });

    it("returns error when DB is unreachable", async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("Connection refused"));
      const health = await provider.healthCheck();
      expect(health.status).toBe("disconnected");
      expect(health.error).toContain("Connection refused");
    });
  });
});
