// ---------------------------------------------------------------------------
// Tests — OptimizationLoop
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { OptimizationLoop } from "../optimization-loop.js";

describe("OptimizationLoop", () => {
  it("reviews campaigns and ad sets", async () => {
    const loop = new OptimizationLoop();
    const result = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Sales Campaign",
          dailyBudget: 50,
          spend: 45,
          conversions: 10,
          cpa: 4.5,
          roas: 3.0,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as1",
          campaignId: "c1",
          dailyBudget: 50,
          spend: 45,
          conversions: 10,
          cpa: 4.5,
          bidStrategy: "COST_CAP",
          bidAmount: 5,
          learningPhase: false,
        },
      ],
    });

    expect(result.accountId).toBe("act_123");
    expect(result.reviewedAt).toBeDefined();
    expect(typeof result.overallScore).toBe("number");
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.tier1Actions).toHaveLength(0);
    expect(result.tier2Actions).toHaveLength(0);
    expect(result.budgetRecommendations).toBeDefined();
  });

  it("generates tier2 pause recommendation for zero-spend campaign", async () => {
    const loop = new OptimizationLoop();
    const result = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Stalled Campaign",
          dailyBudget: 100,
          spend: 0,
          conversions: 0,
          cpa: null,
          roas: null,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [],
    });

    expect(result.tier2Actions.length).toBeGreaterThanOrEqual(1);
    const pauseAction = result.tier2Actions.find(
      (a) => a.actionType === "digital-ads.campaign.pause",
    );
    expect(pauseAction).toBeDefined();
    expect(pauseAction!.reason).toContain("$0 spend");
    expect(pauseAction!.riskLevel).toBe("medium");
  });

  it("generates tier1 pause action for zero-conversion ad set with high spend", async () => {
    const loop = new OptimizationLoop();
    const result = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Campaign",
          dailyBudget: 200,
          spend: 200,
          conversions: 0,
          cpa: null,
          roas: null,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as1",
          campaignId: "c1",
          dailyBudget: 200,
          spend: 200,
          conversions: 0,
          cpa: 50,
          bidStrategy: "COST_CAP",
          bidAmount: 50,
          learningPhase: false,
        },
      ],
    });

    const pauseAction = result.tier1Actions.find(
      (a) => a.actionType === "digital-ads.adset.pause" &&
        (a.parameters as Record<string, unknown>).adSetId === "as1",
    );
    expect(pauseAction).toBeDefined();
    expect(pauseAction!.reason).toContain("Zero conversions");
  });

  it("computes overall score with learning phase penalty", async () => {
    const loop = new OptimizationLoop();
    const result = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Campaign",
          dailyBudget: 100,
          spend: 80,
          conversions: 5,
          cpa: 16,
          roas: 2,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as1",
          campaignId: "c1",
          dailyBudget: 50,
          spend: 40,
          conversions: 3,
          cpa: 13.33,
          bidStrategy: "COST_CAP",
          bidAmount: 15,
          learningPhase: true,
        },
        {
          adSetId: "as2",
          campaignId: "c1",
          dailyBudget: 50,
          spend: 40,
          conversions: 2,
          cpa: 20,
          bidStrategy: "COST_CAP",
          bidAmount: 20,
          learningPhase: true,
        },
      ],
    });

    // 2 learning phase ad sets -> -10 to score
    expect(result.overallScore).toBeLessThan(100);
  });

  // ── Budget skew detection ──────────────────────────────────────────

  it("detects budget skew when campaign has >60% budget but <30% conversions", async () => {
    const loop = new OptimizationLoop();
    const result = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c_high_budget",
          campaignName: "High Budget Low Conv",
          dailyBudget: 800,
          spend: 700,
          conversions: 5,
          cpa: 140,
          roas: 0.5,
          deliveryStatus: "ACTIVE",
        },
        {
          campaignId: "c_low_budget",
          campaignName: "Low Budget High Conv",
          dailyBudget: 200,
          spend: 180,
          conversions: 50,
          cpa: 3.6,
          roas: 8,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [],
    });

    // c_high_budget: 80% of budget, 9% of conversions -> should trigger
    const skewAction = result.tier2Actions.find(
      (a) =>
        a.actionType === "digital-ads.campaign.adjust_budget" &&
        (a.parameters as Record<string, unknown>).campaignId === "c_high_budget",
    );
    expect(skewAction).toBeDefined();
    expect(skewAction!.reason).toContain("budget");
    expect(skewAction!.reason).toContain("conversions");
  });

  // ── Bid strategy mismatch ──────────────────────────────────────────

  it("detects bid strategy mismatch for LOWEST_COST_WITHOUT_CAP with high CPA", async () => {
    const loop = new OptimizationLoop();
    const _result = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Campaign",
          dailyBudget: 200,
          spend: 200,
          conversions: 20,
          cpa: 10,
          roas: 3,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as_cheap",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 18,
          cpa: 5.56,
          bidStrategy: "COST_CAP",
          bidAmount: 10,
          learningPhase: false,
        },
        {
          adSetId: "as_expensive",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 2,
          cpa: 50,
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          bidAmount: null,
          learningPhase: false,
        },
      ],
    });

    // Average CPA = (5.56 + 50) / 2 = 27.78
    // as_expensive CPA (50) > 2 * 27.78 = 55.56? No, 50 < 55.56
    // Actually let's check: avgAdSetCPA = 27.78, 50 > 2*27.78=55.56? 50 < 55.56, so no trigger
    // We need to make the expensive one more extreme
    // Let's test with clearer numbers
    const _result2 = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Campaign",
          dailyBudget: 200,
          spend: 200,
          conversions: 12,
          cpa: 16.67,
          roas: 2,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as_good",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 10,
          cpa: 10,
          bidStrategy: "COST_CAP",
          bidAmount: 10,
          learningPhase: false,
        },
        {
          adSetId: "as_bad",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 2,
          cpa: 50,
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          bidAmount: null,
          learningPhase: false,
        },
      ],
    });

    // Average CPA = (10 + 50) / 2 = 30
    // as_bad CPA (50) > 2 * 30 = 60? No, 50 < 60. Still no trigger.
    // Need CPA > 2x average. avg = 30, need > 60
    const _result3 = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Campaign",
          dailyBudget: 200,
          spend: 200,
          conversions: 11,
          cpa: 18.18,
          roas: 2,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as_good",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 10,
          cpa: 10,
          bidStrategy: "COST_CAP",
          bidAmount: 10,
          learningPhase: false,
        },
        {
          adSetId: "as_terrible",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 1,
          cpa: 100,
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          bidAmount: null,
          learningPhase: false,
        },
      ],
    });

    // Average CPA = (10 + 100) / 2 = 55
    // as_terrible CPA (100) > 2 * 55 = 110? No. 100 < 110 still
    // Need even more extreme: make average lower
    const result4 = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Campaign",
          dailyBudget: 300,
          spend: 300,
          conversions: 31,
          cpa: 9.68,
          roas: 3,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as_good1",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 20,
          cpa: 5,
          bidStrategy: "COST_CAP",
          bidAmount: 10,
          learningPhase: false,
        },
        {
          adSetId: "as_good2",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 10,
          cpa: 10,
          bidStrategy: "COST_CAP",
          bidAmount: 10,
          learningPhase: false,
        },
        {
          adSetId: "as_terrible",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 100,
          conversions: 1,
          cpa: 100,
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          bidAmount: null,
          learningPhase: false,
        },
      ],
    });

    // Average CPA = (5 + 10 + 100) / 3 = 38.33
    // as_terrible CPA (100) > 2 * 38.33 = 76.67? Yes!
    const bidAction = result4.tier2Actions.find(
      (a) =>
        a.actionType === "digital-ads.bid.update_strategy" &&
        (a.parameters as Record<string, unknown>).adSetId === "as_terrible",
    );
    expect(bidAction).toBeDefined();
    expect(bidAction!.reason).toContain("LOWEST_COST_WITHOUT_CAP");
    expect(bidAction!.reason).toContain("COST_CAP");
  });

  // ── Creative fatigue actions ──────────────────────────────────────

  it("pauses ad set with >$500 spend and zero conversions as creative fatigue", async () => {
    const loop = new OptimizationLoop();
    const result = await loop.review({
      accountId: "act_123",
      campaigns: [
        {
          campaignId: "c1",
          campaignName: "Campaign",
          dailyBudget: 100,
          spend: 600,
          conversions: 0,
          cpa: null,
          roas: null,
          deliveryStatus: "ACTIVE",
        },
      ],
      adSets: [
        {
          adSetId: "as_fatigue",
          campaignId: "c1",
          dailyBudget: 100,
          spend: 600,
          conversions: 0,
          cpa: null,
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          bidAmount: null,
          learningPhase: false,
        },
      ],
    });

    // Should have at least one tier1 pause action for as_fatigue
    const pauseActions = result.tier1Actions.filter(
      (a) =>
        a.actionType === "digital-ads.adset.pause" &&
        (a.parameters as Record<string, unknown>).adSetId === "as_fatigue",
    );
    expect(pauseActions.length).toBeGreaterThanOrEqual(1);
  });
});
