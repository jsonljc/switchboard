import { describe, it, expect, vi } from "vitest";
import { PrismaConversationStateReadStore } from "../prisma-conversation-state-read-store.js";

function makeReplyTimeStatsPrisma(rows: Array<{ createdAt: Date; firstReplyAt: Date | null }>) {
  return {
    conversationState: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  };
}

describe("PrismaConversationStateReadStore.replyTimeStats", () => {
  it("returns the median latency for today's replied conversations and the sample size", async () => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Row A: 10s latency (today)
    const createdA = new Date(today.getTime() + 9 * 3600_000);
    const replyA = new Date(today.getTime() + 9 * 3600_000 + 10_000);
    // Row B: 30s latency (today)
    const createdB = new Date(today.getTime() + 10 * 3600_000);
    const replyB = new Date(today.getTime() + 10 * 3600_000 + 30_000);
    // Row C: null firstReplyAt — excluded by DB query filter
    // Row D: yesterday's row — excluded by DB query filter
    // (In the mock, we simulate the DB already filtering by day + firstReplyAt != null)

    const prisma = makeReplyTimeStatsPrisma([
      { createdAt: createdA, firstReplyAt: replyA },
      { createdAt: createdB, firstReplyAt: replyB },
    ]);
    const store = new PrismaConversationStateReadStore(prisma as never);
    const stats = await store.replyTimeStats("org-replytime", today);

    expect(stats.sampleSize).toBe(2);
    expect(stats.medianSeconds).toBe(20); // median of [10, 30]
  });

  it("excludes conversations whose firstReplyAt is more than 24h after createdAt (SLA cap)", async () => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const createdZ = new Date(today.getTime() + 1 * 3600_000);
    const replyZ = new Date(today.getTime() + 1 * 3600_000 + 25 * 3600_000); // 25h later

    const prisma = makeReplyTimeStatsPrisma([{ createdAt: createdZ, firstReplyAt: replyZ }]);
    const store = new PrismaConversationStateReadStore(prisma as never);
    const stats = await store.replyTimeStats("org-sla", today);

    expect(stats.sampleSize).toBe(0);
    expect(stats.medianSeconds).toBe(0);
  });

  it("returns sampleSize=0 and medianSeconds=0 when no eligible rows", async () => {
    const prisma = makeReplyTimeStatsPrisma([]);
    const store = new PrismaConversationStateReadStore(prisma as never);
    const stats = await store.replyTimeStats("org-empty", new Date());

    expect(stats.sampleSize).toBe(0);
    expect(stats.medianSeconds).toBe(0);
  });

  it("computes correct median for an odd number of latencies", async () => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // 3 rows: 10s, 20s, 60s → sorted [10, 20, 60] → median = 20
    const base = today.getTime() + 9 * 3600_000;
    const prisma = makeReplyTimeStatsPrisma([
      { createdAt: new Date(base), firstReplyAt: new Date(base + 10_000) },
      { createdAt: new Date(base + 3600_000), firstReplyAt: new Date(base + 3600_000 + 20_000) },
      { createdAt: new Date(base + 7200_000), firstReplyAt: new Date(base + 7200_000 + 60_000) },
    ]);
    const store = new PrismaConversationStateReadStore(prisma as never);
    const stats = await store.replyTimeStats("org-odd", today);

    expect(stats.sampleSize).toBe(3);
    expect(stats.medianSeconds).toBe(20);
  });

  it("passes correct where clause to Prisma (organizationId, createdAt range, firstReplyAt not null)", async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const prisma = makeReplyTimeStatsPrisma([]);
    const store = new PrismaConversationStateReadStore(prisma as never);
    await store.replyTimeStats("org-check", today);

    expect(prisma.conversationState.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-check",
        createdAt: { gte: today, lt: tomorrow },
        firstReplyAt: { not: null },
      },
      select: { createdAt: true, firstReplyAt: true },
    });
  });
});
