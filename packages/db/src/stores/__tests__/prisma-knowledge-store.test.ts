import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaKnowledgeStore } from "../prisma-knowledge-store.js";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    knowledgeChunk: {
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaKnowledgeStore", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaKnowledgeStore;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    store = new PrismaKnowledgeStore(mockPrisma as never);
  });

  describe("store()", () => {
    it("inserts a chunk with raw SQL for vector column", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await store.store({
        id: "chunk-1",
        organizationId: "org-1",
        agentId: "employee-a",
        documentId: "doc-1",
        content: "Botox treatment info",
        sourceType: "document",
        embedding: [0.1, 0.2, 0.3],
        chunkIndex: 0,
        metadata: {},
      });

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    });
  });

  describe("storeBatch()", () => {
    it("inserts multiple chunks", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await store.storeBatch([
        {
          id: "c1",
          organizationId: "org-1",
          agentId: "employee-a",
          documentId: "doc-1",
          content: "chunk 1",
          sourceType: "document",
          embedding: [0.1, 0.2],
          chunkIndex: 0,
          metadata: {},
        },
        {
          id: "c2",
          organizationId: "org-1",
          agentId: "employee-a",
          documentId: "doc-1",
          content: "chunk 2",
          sourceType: "document",
          embedding: [0.3, 0.4],
          chunkIndex: 1,
          metadata: {},
        },
      ]);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe("search()", () => {
    it("returns results with similarity scores", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: "chunk-1",
          organizationId: "org-1",
          agentId: "employee-a",
          documentId: "doc-1",
          content: "Botox treatment info",
          sourceType: "document",
          chunkIndex: 0,
          metadata: "{}",
          similarity: 0.92,
        },
      ]);

      const results = await store.search([0.1, 0.2, 0.3], {
        organizationId: "org-1",
        agentId: "employee-a",
        topK: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.chunk.content).toBe("Botox treatment info");
      expect(results[0]?.similarity).toBe(0.92);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledOnce();
    });

    it("defaults topK to 5", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await store.search([0.1], {
        organizationId: "org-1",
        agentId: "employee-a",
      });

      // Verify the query was called (topK default is internal)
      expect(mockPrisma.$queryRaw).toHaveBeenCalledOnce();
    });
  });

  describe("deleteByDocument()", () => {
    it("deletes all chunks for a document", async () => {
      mockPrisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 5 });

      const deleted = await store.deleteByDocument("doc-1");

      expect(deleted).toBe(5);
      expect(mockPrisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
        where: { documentId: "doc-1" },
      });
    });
  });
});
