import { describe, it, expect, vi } from "vitest";
import { buildOperatorSummary } from "../operator-summary.js";

// Mock the meta-campaign-provider to avoid real API calls
vi.mock("../../utils/meta-campaign-provider.js", () => ({
  getOrgScopedMetaAdsContext: vi.fn().mockRejectedValue(new Error("Meta Ads connection not found")),
}));

function createMockPrisma(
  outcomeRows: Array<{ outcomeType: string; _count: { id: number } }> = [],
) {
  return {
    crmContact: {
      count: vi.fn().mockResolvedValue(10),
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
      findMany: vi.fn().mockResolvedValue([]),
    },
    outcomeEvent: {
      groupBy: vi.fn().mockResolvedValue(outcomeRows),
    },
  };
}

describe("buildOperatorSummary outcomeBreakdown", () => {
  it("includes outcome breakdown from OutcomeEvent table", async () => {
    const mockPrisma = createMockPrisma([
      { outcomeType: "booked", _count: { id: 5 } },
      { outcomeType: "lost", _count: { id: 3 } },
      { outcomeType: "escalated_unresolved", _count: { id: 2 } },
      { outcomeType: "escalated_resolved", _count: { id: 1 } },
      { outcomeType: "unresponsive", _count: { id: 4 } },
      { outcomeType: "reactivated", _count: { id: 1 } },
    ]);

    const summary = await buildOperatorSummary({
      prisma: mockPrisma as never,
      redis: null,
      organizationId: "org-1",
    });

    expect(summary.outcomes.outcomeBreakdown).toEqual({
      booked: 5,
      lost: 3,
      escalated_unresolved: 2,
      escalated_resolved: 1,
      unresponsive: 4,
      reactivated: 1,
    });
  });

  it("defaults to zero counts when no outcome events exist", async () => {
    const mockPrisma = createMockPrisma([]);

    const summary = await buildOperatorSummary({
      prisma: mockPrisma as never,
      redis: null,
      organizationId: "org-1",
    });

    expect(summary.outcomes.outcomeBreakdown).toEqual({
      booked: 0,
      lost: 0,
      escalated_unresolved: 0,
      escalated_resolved: 0,
      unresponsive: 0,
      reactivated: 0,
    });
  });

  it("ignores unknown outcome types", async () => {
    const mockPrisma = createMockPrisma([
      { outcomeType: "booked", _count: { id: 2 } },
      { outcomeType: "unknown_type", _count: { id: 99 } },
    ]);

    const summary = await buildOperatorSummary({
      prisma: mockPrisma as never,
      redis: null,
      organizationId: "org-1",
    });

    expect(summary.outcomes.outcomeBreakdown.booked).toBe(2);
    expect(summary.outcomes.outcomeBreakdown).not.toHaveProperty("unknown_type");
  });
});
