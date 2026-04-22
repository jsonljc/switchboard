import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentStore } from "../prisma-deployment-store.js";

function createMockPrisma() {
  return {
    agentDeployment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaDeploymentStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaDeploymentStore(prisma as never);
  });

  describe("create", () => {
    it("creates a deployment with all fields", async () => {
      const input = {
        organizationId: "org-1",
        listingId: "lst-1",
        inputConfig: { endpoint: "https://api.example.com" },
        governanceSettings: { approvalRequired: true },
        outputDestination: { channel: "email" },
        connectionIds: ["conn-1", "conn-2"],
      };
      prisma.agentDeployment.create.mockResolvedValue({
        id: "dep_1",
        ...input,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await store.create(input);

      expect(prisma.agentDeployment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          listingId: "lst-1",
          inputConfig: { endpoint: "https://api.example.com" },
          governanceSettings: { approvalRequired: true },
          outputDestination: { channel: "email" },
          connectionIds: ["conn-1", "conn-2"],
        }),
      });
      expect(result.id).toBe("dep_1");
    });

    it("creates deployment with minimal required fields", async () => {
      const input = {
        organizationId: "org-1",
        listingId: "lst-1",
      };
      prisma.agentDeployment.create.mockResolvedValue({
        id: "dep_2",
        ...input,
        status: "active",
        inputConfig: null,
        governanceSettings: null,
        outputDestination: null,
        connectionIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await store.create(input);

      expect(prisma.agentDeployment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          listingId: "lst-1",
          connectionIds: [],
        }),
      });
    });
  });

  describe("findById", () => {
    it("returns null when deployment not found", async () => {
      prisma.agentDeployment.findUnique.mockResolvedValue(null);

      const result = await store.findById("dep_999");

      expect(result).toBeNull();
      expect(prisma.agentDeployment.findUnique).toHaveBeenCalledWith({
        where: { id: "dep_999" },
      });
    });

    it("returns deployment when found", async () => {
      prisma.agentDeployment.findUnique.mockResolvedValue({
        id: "dep_1",
        organizationId: "org-1",
        listingId: "lst-1",
        status: "active",
      });

      const result = await store.findById("dep_1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("dep_1");
      expect(result?.status).toBe("active");
    });
  });

  describe("listByOrg", () => {
    it("lists all deployments for org", async () => {
      prisma.agentDeployment.findMany.mockResolvedValue([
        { id: "dep_1", organizationId: "org-1", status: "active" },
        { id: "dep_2", organizationId: "org-1", status: "paused" },
      ]);

      const result = await store.listByOrg("org-1");

      expect(prisma.agentDeployment.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });

    it("filters by status", async () => {
      prisma.agentDeployment.findMany.mockResolvedValue([
        { id: "dep_1", organizationId: "org-1", status: "active" },
      ]);

      await store.listByOrg("org-1", "active");

      expect(prisma.agentDeployment.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", status: "active" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("updateStatus", () => {
    it("updates deployment status", async () => {
      prisma.agentDeployment.update.mockResolvedValue({
        id: "dep_1",
        status: "paused",
      });

      const result = await store.updateStatus("dep_1", "paused");

      expect(prisma.agentDeployment.update).toHaveBeenCalledWith({
        where: { id: "dep_1" },
        data: { status: "paused" },
      });
      expect(result.status).toBe("paused");
    });
  });

  describe("update", () => {
    it("merges partial inputConfig into existing deployment", async () => {
      prisma.agentDeployment.findUnique.mockResolvedValue({
        id: "dep_1",
        organizationId: "org-1",
        listingId: "lst-1",
        status: "active",
        inputConfig: { persona: { businessName: "Acme" }, bookingLink: "https://old.link" },
        governanceSettings: {},
        connectionIds: [],
      });
      prisma.agentDeployment.update.mockResolvedValue({
        id: "dep_1",
        organizationId: "org-1",
        listingId: "lst-1",
        status: "active",
        inputConfig: {
          persona: { businessName: "Acme" },
          bookingLink: "https://old.link",
          businessFacts: { industry: "SaaS" },
        },
        governanceSettings: {},
        connectionIds: [],
      });

      const result = await store.update("dep_1", {
        inputConfig: { businessFacts: { industry: "SaaS" } },
      });

      expect(prisma.agentDeployment.findUnique).toHaveBeenCalledWith({
        where: { id: "dep_1" },
      });
      expect(prisma.agentDeployment.update).toHaveBeenCalledWith({
        where: { id: "dep_1" },
        data: {
          inputConfig: {
            persona: { businessName: "Acme" },
            bookingLink: "https://old.link",
            businessFacts: { industry: "SaaS" },
          },
        },
      });
      expect(result).not.toBeNull();
      expect(result?.inputConfig).toEqual({
        persona: { businessName: "Acme" },
        bookingLink: "https://old.link",
        businessFacts: { industry: "SaaS" },
      });
    });

    it("returns null when deployment not found", async () => {
      prisma.agentDeployment.findUnique.mockResolvedValue(null);

      const result = await store.update("dep_999", {
        inputConfig: { foo: "bar" },
      });

      expect(result).toBeNull();
      expect(prisma.agentDeployment.update).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("deletes a deployment", async () => {
      prisma.agentDeployment.delete.mockResolvedValue({});

      await store.delete("dep_1");

      expect(prisma.agentDeployment.delete).toHaveBeenCalledWith({ where: { id: "dep_1" } });
    });
  });
});
