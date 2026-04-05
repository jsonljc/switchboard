import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAgentPersonaStore } from "../prisma-agent-persona-store.js";

function createMockPrisma() {
  return {
    agentPersona: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaAgentPersonaStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAgentPersonaStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAgentPersonaStore(prisma as never);
  });

  describe("getByOrgId", () => {
    it("returns persona when found", async () => {
      const persona = {
        id: "p1",
        organizationId: "org1",
        businessName: "Test Business",
        businessType: "SaaS",
        productService: "CRM",
        valueProposition: "Better sales",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        bookingLink: null,
        escalationRules: {},
        customInstructions: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.agentPersona.findUnique.mockResolvedValue(persona);

      const result = await store.getByOrgId("org1");

      expect(prisma.agentPersona.findUnique).toHaveBeenCalledWith({
        where: { organizationId: "org1" },
      });
      expect(result).toEqual(persona);
    });

    it("returns null when not found", async () => {
      prisma.agentPersona.findUnique.mockResolvedValue(null);
      const result = await store.getByOrgId("org-missing");
      expect(result).toBeNull();
    });
  });

  describe("upsert", () => {
    it("creates or updates persona", async () => {
      const data = {
        businessName: "Acme",
        businessType: "SaaS",
        productService: "CRM",
        valueProposition: "Better sales",
        tone: "professional" as const,
        qualificationCriteria: { minBudget: 10000 },
        disqualificationCriteria: { industries: ["gambling"] },
        bookingLink: null,
        escalationRules: { highValue: true },
        customInstructions: null,
      };
      const created = {
        id: "p1",
        organizationId: "org1",
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.agentPersona.upsert.mockResolvedValue(created);

      const result = await store.upsert("org1", data);

      expect(prisma.agentPersona.upsert).toHaveBeenCalledWith({
        where: { organizationId: "org1" },
        create: { organizationId: "org1", ...data },
        update: data,
      });
      expect(result.businessName).toBe("Acme");
    });
  });

  describe("delete", () => {
    it("deletes persona by org id", async () => {
      prisma.agentPersona.delete.mockResolvedValue({ id: "p1" });
      await store.delete("org1");
      expect(prisma.agentPersona.delete).toHaveBeenCalledWith({
        where: { organizationId: "org1" },
      });
    });
  });
});
