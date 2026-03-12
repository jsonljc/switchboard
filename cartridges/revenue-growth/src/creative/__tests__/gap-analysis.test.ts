import { describe, it, expect } from "vitest";
import { analyzeCreativeGaps } from "../gap-analysis.js";
import type { NormalizedData, AccountLearningProfile } from "@switchboard/schemas";

function makeNormalizedData(overrides: Partial<NormalizedData> = {}): NormalizedData {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    collectedAt: new Date().toISOString(),
    dataTier: "FULL",
    adMetrics: {
      impressions: 100000,
      clicks: 2500,
      spend: 5000,
      conversions: 100,
      revenue: 25000,
      ctr: 0.025,
      cpc: 2,
      cpa: 50,
      roas: 5,
      frequency: 2.5,
    },
    funnelEvents: [],
    creativeAssets: {
      totalAssets: 20,
      activeAssets: 15,
      averageScore: 65,
      fatigueRate: 0.15,
      topPerformerCount: 5,
      bottomPerformerCount: 3,
      diversityScore: 55,
    },
    crmSummary: null,
    signalHealth: null,
    headroom: null,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<AccountLearningProfile> = {}): AccountLearningProfile {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    creativePatterns: [],
    constraintHistory: [],
    calibration: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("analyzeCreativeGaps", () => {
  it("returns an overall score between 0 and 100", () => {
    const data = makeNormalizedData();
    const result = analyzeCreativeGaps(data);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it("evaluates all 7 criteria", () => {
    const data = makeNormalizedData();
    const result = analyzeCreativeGaps(data);
    expect(result.criteria).toHaveLength(7);

    const names = result.criteria.map((c) => c.name);
    expect(names).toContain("FORMAT_DIVERSITY");
    expect(names).toContain("HOOK_VARIETY");
    expect(names).toContain("CTA_COVERAGE");
    expect(names).toContain("AUDIENCE_MATCH");
    expect(names).toContain("PLATFORM_FIT");
    expect(names).toContain("RECENCY");
    expect(names).toContain("PERFORMANCE_SPREAD");
  });

  it("weights sum to 1.0", () => {
    const data = makeNormalizedData();
    const result = analyzeCreativeGaps(data);
    const totalWeight = result.criteria.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it("identifies significant gaps below threshold", () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 5,
        activeAssets: 2,
        averageScore: 20,
        fatigueRate: 0.6,
        topPerformerCount: 0,
        bottomPerformerCount: 4,
        diversityScore: 10,
      },
    });

    const result = analyzeCreativeGaps(data);
    expect(result.hasSignificantGaps).toBe(true);
    expect(result.significantGaps.length).toBeGreaterThan(0);
  });

  it("reports no significant gaps for healthy portfolio", () => {
    const data = makeNormalizedData({
      adMetrics: {
        impressions: 100000,
        clicks: 5000,
        spend: 5000,
        conversions: 200,
        revenue: 50000,
        ctr: 0.05, // 5% CTR = max score
        cpc: 1,
        cpa: 25,
        roas: 10,
        frequency: 1.5,
      },
      creativeAssets: {
        totalAssets: 20,
        activeAssets: 20,
        averageScore: 85,
        fatigueRate: 0.05,
        topPerformerCount: 10,
        bottomPerformerCount: 1,
        diversityScore: 90,
      },
    });

    const result = analyzeCreativeGaps(data);
    // Most criteria should be above threshold
    expect(result.overallScore).toBeGreaterThan(50);
  });

  it("handles missing creative data gracefully", () => {
    const data = makeNormalizedData({ creativeAssets: null });
    const result = analyzeCreativeGaps(data);

    expect(result.overallScore).toBeDefined();
    expect(result.hasSignificantGaps).toBe(true);
    // Multiple criteria should report "No creative data available"
    const noDataCriteria = result.criteria.filter((c) =>
      c.findings.some((f) => f.includes("No creative data") || f.includes("Cannot assess")),
    );
    expect(noDataCriteria.length).toBeGreaterThan(0);
  });

  it("uses account profile for hook variety when available", () => {
    const data = makeNormalizedData();
    const profile = makeProfile({
      creativePatterns: [
        { format: "video", hookType: "question", performanceScore: 80, sampleSize: 5 },
        { format: "image", hookType: "statistic", performanceScore: 70, sampleSize: 3 },
        { format: "carousel", hookType: "testimonial", performanceScore: 75, sampleSize: 4 },
        { format: "ugc", hookType: "problem-solution", performanceScore: 65, sampleSize: 2 },
      ],
    });

    const withProfile = analyzeCreativeGaps(data, profile);
    const withoutProfile = analyzeCreativeGaps(data);

    const hookWithProfile = withProfile.criteria.find((c) => c.name === "HOOK_VARIETY");
    const hookWithout = withoutProfile.criteria.find((c) => c.name === "HOOK_VARIETY");

    expect(hookWithProfile!.score).toBeGreaterThan(hookWithout!.score);
  });

  it("calculates weighted scores correctly", () => {
    const data = makeNormalizedData();
    const result = analyzeCreativeGaps(data);

    for (const criterion of result.criteria) {
      expect(criterion.weightedScore).toBeCloseTo(criterion.score * criterion.weight);
    }

    const expectedOverall = result.criteria.reduce((sum, c) => sum + c.weightedScore, 0);
    expect(result.overallScore).toBeCloseTo(expectedOverall);
  });

  it("includes analyzedAt timestamp", () => {
    const data = makeNormalizedData();
    const result = analyzeCreativeGaps(data);
    expect(result.analyzedAt).toBeDefined();
    expect(new Date(result.analyzedAt).getTime()).not.toBeNaN();
  });

  it("detects high fatigue as recency gap", () => {
    const data = makeNormalizedData({
      creativeAssets: {
        totalAssets: 20,
        activeAssets: 15,
        averageScore: 70,
        fatigueRate: 0.45,
        topPerformerCount: 5,
        bottomPerformerCount: 3,
        diversityScore: 60,
      },
    });

    const result = analyzeCreativeGaps(data);
    const recency = result.criteria.find((c) => c.name === "RECENCY");
    expect(recency!.score).toBeLessThan(50);
    expect(recency!.findings.some((f) => f.includes("fatigue"))).toBe(true);
  });

  it("scores CTR-based audience match", () => {
    const lowCtrData = makeNormalizedData({
      adMetrics: {
        impressions: 100000,
        clicks: 500,
        spend: 5000,
        conversions: 10,
        revenue: 2000,
        ctr: 0.005, // 0.5% CTR
        cpc: 10,
        cpa: 500,
        roas: 0.4,
        frequency: 5,
      },
    });

    const result = analyzeCreativeGaps(lowCtrData);
    const audienceMatch = result.criteria.find((c) => c.name === "AUDIENCE_MATCH");
    expect(audienceMatch!.score).toBeLessThan(50);
  });
});
