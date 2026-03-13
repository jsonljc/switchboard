import { describe, it, expect, vi } from "vitest";
import { buildOperatorSummary } from "../operator-summary.js";

function createMockPrisma(conversations: unknown[] = []) {
  return {
    crmContact: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    crmDeal: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    auditEntry: {
      count: vi.fn().mockResolvedValue(0),
    },
    conversationState: {
      findMany: vi.fn().mockResolvedValue(conversations),
    },
  };
}

// Mock the meta-campaign-provider to avoid real API calls
vi.mock("../../utils/meta-campaign-provider.js", () => ({
  getOrgScopedMetaAdsContext: vi.fn().mockRejectedValue(new Error("Meta Ads connection not found")),
}));

describe("Speed-to-Lead in OperatorSummary", () => {
  it("returns null metrics when no conversations exist", async () => {
    const prisma = createMockPrisma([]);
    const summary = await buildOperatorSummary({
      prisma: prisma as never,
      organizationId: "org_1",
    });

    expect(summary.speedToLead).toEqual({
      averageMs: null,
      p50Ms: null,
      p95Ms: null,
      sampleSize: 0,
    });
  });

  it("computes average, p50, p95 from conversation response times", async () => {
    const now = new Date();
    const conversations = [
      {
        firstReplyAt: new Date(now.getTime() - 50_000 + 10_000), // 10s response
        messages: [{ role: "user", timestamp: new Date(now.getTime() - 50_000).toISOString() }],
      },
      {
        firstReplyAt: new Date(now.getTime() - 40_000 + 20_000), // 20s response
        messages: [{ role: "user", timestamp: new Date(now.getTime() - 40_000).toISOString() }],
      },
      {
        firstReplyAt: new Date(now.getTime() - 30_000 + 5_000), // 5s response
        messages: [{ role: "user", timestamp: new Date(now.getTime() - 30_000).toISOString() }],
      },
    ];

    const prisma = createMockPrisma(conversations);
    const summary = await buildOperatorSummary({
      prisma: prisma as never,
      organizationId: "org_1",
    });

    // avg = (10000 + 20000 + 5000) / 3 ≈ 11667
    expect(summary.speedToLead.averageMs).toBe(Math.round((10_000 + 20_000 + 5_000) / 3));
    expect(summary.speedToLead.sampleSize).toBe(3);
    // p50 = sorted[1] = 10000 (sorted: 5000, 10000, 20000)
    expect(summary.speedToLead.p50Ms).toBe(10_000);
    // p95 = sorted[2] = 20000 (floor(3 * 0.95) = 2)
    expect(summary.speedToLead.p95Ms).toBe(20_000);
  });

  it("skips conversations with no user messages", async () => {
    const now = new Date();
    const conversations = [
      {
        firstReplyAt: new Date(now.getTime() + 5_000),
        messages: [{ role: "assistant", timestamp: now.toISOString() }],
      },
    ];

    const prisma = createMockPrisma(conversations);
    const summary = await buildOperatorSummary({
      prisma: prisma as never,
      organizationId: "org_1",
    });

    expect(summary.speedToLead.sampleSize).toBe(0);
    expect(summary.speedToLead.averageMs).toBeNull();
  });

  it("handles messages stored as JSON string", async () => {
    const now = new Date();
    const userTime = new Date(now.getTime() - 15_000);
    const replyTime = new Date(now.getTime() - 15_000 + 8_000); // 8s response

    const conversations = [
      {
        firstReplyAt: replyTime,
        messages: JSON.stringify([{ role: "user", timestamp: userTime.toISOString() }]),
      },
    ];

    const prisma = createMockPrisma(conversations);
    const summary = await buildOperatorSummary({
      prisma: prisma as never,
      organizationId: "org_1",
    });

    expect(summary.speedToLead.averageMs).toBe(8_000);
    expect(summary.speedToLead.sampleSize).toBe(1);
  });
});
