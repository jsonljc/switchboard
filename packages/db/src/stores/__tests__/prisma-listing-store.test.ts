import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaListingStore } from "../prisma-listing-store.js";

function createMockPrisma() {
  return {
    agentListing: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaListingStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaListingStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaListingStore(prisma as never);
  });

  describe("create", () => {
    it("creates a listing with all fields", async () => {
      const input = {
        name: "Email Agent",
        slug: "email-agent",
        description: "Sends emails",
        type: "switchboard_native" as const,
        taskCategories: ["email"],
        webhookUrl: "https://example.com/webhook",
        webhookSecret: "secret123",
        sourceUrl: "https://github.com/example/email-agent",
        metadata: { version: "1.0.0" },
      };
      prisma.agentListing.create.mockResolvedValue({
        id: "lst_1",
        ...input,
        status: "pending_review",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await store.create(input);

      expect(prisma.agentListing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Email Agent",
          slug: "email-agent",
          description: "Sends emails",
          type: "switchboard_native",
          taskCategories: ["email"],
          webhookUrl: "https://example.com/webhook",
          webhookSecret: "secret123",
          sourceUrl: "https://github.com/example/email-agent",
          metadata: { version: "1.0.0" },
        }),
      });
      expect(result.id).toBe("lst_1");
    });

    it("creates listing with minimal required fields", async () => {
      const input = {
        name: "Simple Agent",
        slug: "simple-agent",
        description: "A simple agent",
        type: "third_party" as const,
        taskCategories: ["general"],
      };
      prisma.agentListing.create.mockResolvedValue({
        id: "lst_2",
        ...input,
        status: "pending_review",
        webhookUrl: null,
        webhookSecret: null,
        sourceUrl: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await store.create(input);

      expect(prisma.agentListing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Simple Agent",
          slug: "simple-agent",
          webhookUrl: null,
          webhookSecret: null,
          sourceUrl: null,
        }),
      });
    });
  });

  describe("findById", () => {
    it("returns null when listing not found", async () => {
      prisma.agentListing.findUnique.mockResolvedValue(null);

      const result = await store.findById("lst_999");

      expect(result).toBeNull();
      expect(prisma.agentListing.findUnique).toHaveBeenCalledWith({ where: { id: "lst_999" } });
    });

    it("returns listing when found", async () => {
      prisma.agentListing.findUnique.mockResolvedValue({
        id: "lst_1",
        slug: "email-agent",
        name: "Email Agent",
      });

      const result = await store.findById("lst_1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("lst_1");
      expect(result?.name).toBe("Email Agent");
    });
  });

  describe("findBySlug", () => {
    it("returns null when slug not found", async () => {
      prisma.agentListing.findUnique.mockResolvedValue(null);

      const result = await store.findBySlug("nonexistent");

      expect(result).toBeNull();
      expect(prisma.agentListing.findUnique).toHaveBeenCalledWith({
        where: { slug: "nonexistent" },
      });
    });

    it("returns listing when slug found", async () => {
      prisma.agentListing.findUnique.mockResolvedValue({
        id: "lst_1",
        slug: "email-agent",
        name: "Email Agent",
      });

      const result = await store.findBySlug("email-agent");

      expect(result).not.toBeNull();
      expect(result?.slug).toBe("email-agent");
    });
  });

  describe("list", () => {
    it("lists all listings with default limit", async () => {
      prisma.agentListing.findMany.mockResolvedValue([]);

      await store.list();

      expect(prisma.agentListing.findMany).toHaveBeenCalledWith({
        where: {},
        take: 50,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
    });

    it("filters by status", async () => {
      prisma.agentListing.findMany.mockResolvedValue([]);

      await store.list({ status: "listed" });

      expect(prisma.agentListing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "listed" },
        }),
      );
    });

    it("filters by type", async () => {
      prisma.agentListing.findMany.mockResolvedValue([]);

      await store.list({ type: "third_party" });

      expect(prisma.agentListing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: "third_party" },
        }),
      );
    });

    it("applies limit and offset", async () => {
      prisma.agentListing.findMany.mockResolvedValue([]);

      await store.list({ limit: 10, offset: 20 });

      expect(prisma.agentListing.findMany).toHaveBeenCalledWith({
        where: {},
        take: 10,
        skip: 20,
        orderBy: { createdAt: "desc" },
      });
    });

    it("combines multiple filters", async () => {
      prisma.agentListing.findMany.mockResolvedValue([]);

      await store.list({ status: "listed", type: "switchboard_native", limit: 5 });

      expect(prisma.agentListing.findMany).toHaveBeenCalledWith({
        where: { status: "listed", type: "switchboard_native" },
        take: 5,
        skip: 0,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("update", () => {
    it("updates listing fields", async () => {
      prisma.agentListing.update.mockResolvedValue({
        id: "lst_1",
        status: "listed",
        description: "Updated description",
      });

      await store.update("lst_1", { status: "listed", description: "Updated description" });

      expect(prisma.agentListing.update).toHaveBeenCalledWith({
        where: { id: "lst_1" },
        data: { status: "listed", description: "Updated description" },
      });
    });
  });

  describe("delete", () => {
    it("deletes a listing", async () => {
      prisma.agentListing.delete.mockResolvedValue({});

      await store.delete("lst_1");

      expect(prisma.agentListing.delete).toHaveBeenCalledWith({ where: { id: "lst_1" } });
    });
  });
});
