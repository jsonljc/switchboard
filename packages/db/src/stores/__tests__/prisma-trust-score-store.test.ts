import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaTrustScoreStore } from "../prisma-trust-score-store.js";

function createMockPrisma() {
  return {
    trustScoreRecord: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
  };
}

describe("PrismaTrustScoreStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaTrustScoreStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaTrustScoreStore(prisma as never);
  });

  describe("getOrCreate", () => {
    it("returns existing record when found", async () => {
      const existing = {
        id: "score_1",
        listingId: "lst-1",
        taskCategory: "email",
        score: 75,
        totalApprovals: 10,
        totalRejections: 2,
        consecutiveApprovals: 5,
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.trustScoreRecord.findUnique.mockResolvedValue(existing);

      const result = await store.getOrCreate("lst-1", "email");

      expect(prisma.trustScoreRecord.findUnique).toHaveBeenCalledWith({
        where: { listingId_taskCategory: { listingId: "lst-1", taskCategory: "email" } },
      });
      expect(result.id).toBe("score_1");
      expect(result.score).toBe(75);
    });

    it("creates new record when not found", async () => {
      prisma.trustScoreRecord.findUnique.mockResolvedValue(null);
      const created = {
        id: "score_2",
        listingId: "lst-1",
        taskCategory: "ads",
        score: 50,
        totalApprovals: 0,
        totalRejections: 0,
        consecutiveApprovals: 0,
        lastActivityAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.trustScoreRecord.create.mockResolvedValue(created);

      const result = await store.getOrCreate("lst-1", "ads");

      expect(prisma.trustScoreRecord.create).toHaveBeenCalledWith({
        data: { listingId: "lst-1", taskCategory: "ads", score: 50 },
      });
      expect(result.id).toBe("score_2");
      expect(result.score).toBe(50);
    });
  });

  describe("update", () => {
    it("updates score and metrics", async () => {
      const updated = {
        id: "score_1",
        score: 80,
        totalApprovals: 15,
        totalRejections: 3,
        consecutiveApprovals: 8,
        lastActivityAt: new Date(),
      };
      prisma.trustScoreRecord.update.mockResolvedValue(updated);

      const result = await store.update("score_1", {
        score: 80,
        totalApprovals: 15,
        totalRejections: 3,
        consecutiveApprovals: 8,
        lastActivityAt: new Date(),
      });

      expect(prisma.trustScoreRecord.update).toHaveBeenCalledWith({
        where: { id: "score_1" },
        data: expect.objectContaining({
          score: 80,
          totalApprovals: 15,
          totalRejections: 3,
          consecutiveApprovals: 8,
        }),
      });
      expect(result.score).toBe(80);
    });

    it("updates partial fields", async () => {
      const updated = {
        id: "score_1",
        score: 85,
      };
      prisma.trustScoreRecord.update.mockResolvedValue(updated);

      await store.update("score_1", { score: 85 });

      expect(prisma.trustScoreRecord.update).toHaveBeenCalledWith({
        where: { id: "score_1" },
        data: { score: 85 },
      });
    });
  });

  describe("listByListing", () => {
    it("lists all trust scores for a listing ordered by score", async () => {
      const scores = [
        { id: "score_1", listingId: "lst-1", taskCategory: "email", score: 90 },
        { id: "score_2", listingId: "lst-1", taskCategory: "ads", score: 75 },
        { id: "score_3", listingId: "lst-1", taskCategory: "general", score: 60 },
      ];
      prisma.trustScoreRecord.findMany.mockResolvedValue(scores);

      const result = await store.listByListing("lst-1");

      expect(prisma.trustScoreRecord.findMany).toHaveBeenCalledWith({
        where: { listingId: "lst-1" },
        orderBy: { score: "desc" },
      });
      expect(result).toHaveLength(3);
      expect(result[0]?.score).toBe(90);
    });

    it("returns empty array when no scores exist", async () => {
      prisma.trustScoreRecord.findMany.mockResolvedValue([]);

      const result = await store.listByListing("lst-999");

      expect(result).toHaveLength(0);
    });
  });

  describe("getAggregateScore", () => {
    it("returns average score for a listing", async () => {
      prisma.trustScoreRecord.aggregate.mockResolvedValue({
        _avg: { score: 75.5 },
      });

      const result = await store.getAggregateScore("lst-1");

      expect(prisma.trustScoreRecord.aggregate).toHaveBeenCalledWith({
        where: { listingId: "lst-1" },
        _avg: { score: true },
      });
      expect(result).toBe(75.5);
    });

    it("returns 50 when no scores exist", async () => {
      prisma.trustScoreRecord.aggregate.mockResolvedValue({
        _avg: { score: null },
      });

      const result = await store.getAggregateScore("lst-999");

      expect(result).toBe(50);
    });

    it("returns 50 when average is null", async () => {
      prisma.trustScoreRecord.aggregate.mockResolvedValue({
        _avg: { score: null },
      });

      const result = await store.getAggregateScore("lst-1");

      expect(result).toBe(50);
    });
  });
});
