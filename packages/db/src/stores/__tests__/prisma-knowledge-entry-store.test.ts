import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaKnowledgeEntryStore } from "../prisma-knowledge-entry-store.js";

function createMockPrisma() {
  return {
    knowledgeEntry: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe("PrismaKnowledgeEntryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaKnowledgeEntryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaKnowledgeEntryStore(prisma as never);
  });

  describe("create", () => {
    it("creates an entry with version 1 and active true", async () => {
      const input = {
        organizationId: "org_test",
        kind: "playbook" as const,
        scope: "objection-handling",
        title: "Objection Playbook",
        content: "When price is too high...",
        priority: 0,
      };
      prisma.knowledgeEntry.create.mockResolvedValue({
        id: "ke_1",
        ...input,
        version: 1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await store.create(input);

      expect(prisma.knowledgeEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org_test",
          kind: "playbook",
          scope: "objection-handling",
          version: 1,
          active: true,
        }),
      });
      expect(result.id).toBe("ke_1");
      expect(result.version).toBe(1);
    });
  });

  describe("findActive", () => {
    it("returns only active entries matching filters", async () => {
      prisma.knowledgeEntry.findMany.mockResolvedValue([
        { id: "ke_1", kind: "playbook", scope: "objection-handling", active: true },
      ]);

      const results = await store.findActive("org_test", [
        { kind: "playbook", scope: "objection-handling" },
      ]);

      expect(prisma.knowledgeEntry.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_test",
          active: true,
          OR: [{ kind: "playbook", scope: "objection-handling" }],
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      });
      expect(results).toHaveLength(1);
    });

    it("returns empty array for empty filters", async () => {
      const results = await store.findActive("org_test", []);
      expect(results).toEqual([]);
      expect(prisma.knowledgeEntry.findMany).not.toHaveBeenCalled();
    });
  });

  describe("update (append-only versioning)", () => {
    it("creates new version and deactivates predecessor", async () => {
      const existing = {
        id: "ke_1",
        organizationId: "org_test",
        kind: "playbook",
        scope: "update-test",
        title: "V1 Title",
        content: "V1 Content",
        priority: 0,
        version: 1,
        active: true,
      };
      prisma.knowledgeEntry.findFirst.mockResolvedValue(existing);
      const newEntry = { ...existing, id: "ke_2", version: 2, title: "V2 Title" };
      prisma.$transaction.mockResolvedValue([{ ...existing, active: false }, newEntry]);

      const result = await store.update("ke_1", "org_test", { title: "V2 Title" });

      expect(result.version).toBe(2);
      expect(result.title).toBe("V2 Title");
      expect(result.content).toBe("V1 Content");
    });

    it("throws when entry not found", async () => {
      prisma.knowledgeEntry.findFirst.mockResolvedValue(null);
      await expect(store.update("ke_none", "org_test", { title: "X" })).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe("deactivate", () => {
    it("soft-deletes by setting active to false", async () => {
      prisma.knowledgeEntry.updateMany.mockResolvedValue({ count: 1 });
      await store.deactivate("ke_1", "org_test");
      expect(prisma.knowledgeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: "ke_1", organizationId: "org_test" },
        data: { active: false },
      });
    });

    it("throws when entry not found (cross-org protection)", async () => {
      prisma.knowledgeEntry.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.deactivate("ke_1", "other_org")).rejects.toThrow(/not found/);
    });
  });

  describe("list", () => {
    it("lists entries with optional kind filter", async () => {
      prisma.knowledgeEntry.findMany.mockResolvedValue([]);
      await store.list("org_test", { kind: "playbook" });
      expect(prisma.knowledgeEntry.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_test", kind: "playbook" },
        orderBy: { createdAt: "desc" },
      });
    });
  });
});
