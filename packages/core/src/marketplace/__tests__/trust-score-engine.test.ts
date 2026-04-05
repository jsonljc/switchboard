import { describe, it, expect } from "vitest";
import { TrustScoreEngine, scoreToAutonomyLevel, scoreToPriceTier } from "../trust-score-engine.js";

describe("scoreToAutonomyLevel", () => {
  it("returns supervised for score < 40", () => {
    expect(scoreToAutonomyLevel(0)).toBe("supervised");
    expect(scoreToAutonomyLevel(39)).toBe("supervised");
  });

  it("returns guided for score 40-69", () => {
    expect(scoreToAutonomyLevel(40)).toBe("guided");
    expect(scoreToAutonomyLevel(69)).toBe("guided");
  });

  it("returns autonomous for score >= 70", () => {
    expect(scoreToAutonomyLevel(70)).toBe("autonomous");
    expect(scoreToAutonomyLevel(100)).toBe("autonomous");
  });
});

describe("scoreToPriceTier", () => {
  it("returns free for score < 30", () => {
    expect(scoreToPriceTier(0)).toBe("free");
    expect(scoreToPriceTier(29)).toBe("free");
  });

  it("returns basic for score 30-54", () => {
    expect(scoreToPriceTier(30)).toBe("basic");
    expect(scoreToPriceTier(54)).toBe("basic");
  });

  it("returns pro for score 55-79", () => {
    expect(scoreToPriceTier(55)).toBe("pro");
    expect(scoreToPriceTier(79)).toBe("pro");
  });

  it("returns elite for score >= 80", () => {
    expect(scoreToPriceTier(80)).toBe("elite");
    expect(scoreToPriceTier(100)).toBe("elite");
  });
});

describe("TrustScoreEngine", () => {
  function createMockStore() {
    const records = new Map<
      string,
      {
        id: string;
        listingId: string;
        taskCategory: string;
        score: number;
        totalApprovals: number;
        totalRejections: number;
        consecutiveApprovals: number;
        lastActivityAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }
    >();
    return {
      getOrCreate: async (listingId: string, taskCategory: string) => {
        const key = `${listingId}:${taskCategory}`;
        if (!records.has(key)) {
          const now = new Date();
          records.set(key, {
            id: key,
            listingId,
            taskCategory,
            score: 50,
            totalApprovals: 0,
            totalRejections: 0,
            consecutiveApprovals: 0,
            lastActivityAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
        return records.get(key)!;
      },
      update: async (id: string, data: Record<string, unknown>) => {
        const record = records.get(id);
        if (!record) throw new Error("not found");
        Object.assign(record, data);
        return record;
      },
      listByListing: async (listingId: string) =>
        [...records.values()].filter((r) => r.listingId === listingId),
      getAggregateScore: async (listingId: string) => {
        const listing = [...records.values()].filter((r) => r.listingId === listingId);
        if (listing.length === 0) return 50;
        return listing.reduce((sum, r) => sum + r.score, 0) / listing.length;
      },
    };
  }

  it("records an approval and increments score", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    await engine.recordApproval("lst_1", "email");
    const record = await store.getOrCreate("lst_1", "email");

    expect(record.score).toBeGreaterThan(50);
    expect(record.totalApprovals).toBe(1);
    expect(record.consecutiveApprovals).toBe(1);
  });

  it("records a rejection and decrements score", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    await engine.recordRejection("lst_1", "email");
    const record = await store.getOrCreate("lst_1", "email");

    expect(record.score).toBeLessThan(50);
    expect(record.totalRejections).toBe(1);
    expect(record.consecutiveApprovals).toBe(0);
  });

  it("gets autonomy level for a listing+category", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    const level = await engine.getAutonomyLevel("lst_1", "email");
    expect(level).toBe("guided"); // default score 50 → guided
  });

  it("gets price tier for a listing", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    const tier = await engine.getPriceTier("lst_1");
    expect(tier).toBe("basic"); // default aggregate score 50 → basic
  });

  it("caps score at 100", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    for (let i = 0; i < 50; i++) {
      await engine.recordApproval("lst_1", "email");
    }
    const record = await store.getOrCreate("lst_1", "email");
    expect(record.score).toBeLessThanOrEqual(100);
  });

  it("floors score at 0", async () => {
    const store = createMockStore();
    const engine = new TrustScoreEngine(store);

    for (let i = 0; i < 20; i++) {
      await engine.recordRejection("lst_1", "email");
    }
    const record = await store.getOrCreate("lst_1", "email");
    expect(record.score).toBeGreaterThanOrEqual(0);
  });
});
