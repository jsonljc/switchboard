// ---------------------------------------------------------------------------
// Creative Depth Scorer — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { scoreCreativeDepth } from "../creative-depth.js";
import type { NormalizedData } from "@switchboard/schemas";

function makeData(overrides: Partial<NormalizedData> = {}): NormalizedData {
  return {
    accountId: "acc_1",
    organizationId: "org_1",
    collectedAt: new Date().toISOString(),
    dataTier: "PARTIAL",
    adMetrics: null,
    funnelEvents: [],
    creativeAssets: null,
    crmSummary: null,
    signalHealth: null,
    ...overrides,
  };
}

describe("scoreCreativeDepth", () => {
  it("returns score 0 with LOW confidence when no creative data", () => {
    const result = scoreCreativeDepth(makeData());
    expect(result.scorerName).toBe("creative-depth");
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("LOW");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe("NO_CREATIVE_DATA");
  });

  it("returns high score for healthy creative portfolio", () => {
    const result = scoreCreativeDepth(
      makeData({
        dataTier: "FULL",
        creativeAssets: {
          totalAssets: 15,
          activeAssets: 12,
          averageScore: 75,
          fatigueRate: 0.05,
          topPerformerCount: 5,
          bottomPerformerCount: 1,
          diversityScore: 80,
        },
      }),
    );

    expect(result.score).toBeGreaterThan(70);
    expect(result.confidence).toBe("HIGH");
  });

  it("flags critical issues for no active creatives", () => {
    const result = scoreCreativeDepth(
      makeData({
        creativeAssets: {
          totalAssets: 5,
          activeAssets: 0,
          averageScore: null,
          fatigueRate: null,
          topPerformerCount: 0,
          bottomPerformerCount: 0,
          diversityScore: null,
        },
      }),
    );

    // Score is very low (volume=0 and other null fields contribute some default)
    expect(result.score).toBeLessThan(30);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("NO_ACTIVE_CREATIVES");
  });

  it("flags low creative volume", () => {
    const result = scoreCreativeDepth(
      makeData({
        creativeAssets: {
          totalAssets: 3,
          activeAssets: 2,
          averageScore: 60,
          fatigueRate: 0.1,
          topPerformerCount: 1,
          bottomPerformerCount: 0,
          diversityScore: 50,
        },
      }),
    );

    const warningCodes = result.issues.filter((i) => i.severity === "warning").map((i) => i.code);
    expect(warningCodes).toContain("LOW_CREATIVE_VOLUME");
  });

  it("flags critical fatigue rate", () => {
    const result = scoreCreativeDepth(
      makeData({
        creativeAssets: {
          totalAssets: 10,
          activeAssets: 8,
          averageScore: 50,
          fatigueRate: 0.6,
          topPerformerCount: 2,
          bottomPerformerCount: 3,
          diversityScore: 40,
        },
      }),
    );

    const criticalCodes = result.issues.filter((i) => i.severity === "critical").map((i) => i.code);
    expect(criticalCodes).toContain("CREATIVE_FATIGUE_CRITICAL");
  });

  it("flags low diversity score", () => {
    const result = scoreCreativeDepth(
      makeData({
        creativeAssets: {
          totalAssets: 10,
          activeAssets: 8,
          averageScore: 60,
          fatigueRate: 0.1,
          topPerformerCount: 3,
          bottomPerformerCount: 1,
          diversityScore: 25,
        },
      }),
    );

    const criticalCodes = result.issues.filter((i) => i.severity === "critical").map((i) => i.code);
    expect(criticalCodes).toContain("CREATIVE_DIVERSITY_CRITICAL");
  });

  it("flags low quality score", () => {
    const result = scoreCreativeDepth(
      makeData({
        creativeAssets: {
          totalAssets: 10,
          activeAssets: 8,
          averageScore: 20,
          fatigueRate: 0.1,
          topPerformerCount: 0,
          bottomPerformerCount: 5,
          diversityScore: 60,
        },
      }),
    );

    const criticalCodes = result.issues.filter((i) => i.severity === "critical").map((i) => i.code);
    expect(criticalCodes).toContain("CREATIVE_QUALITY_CRITICAL");
  });

  it("provides score breakdown", () => {
    const result = scoreCreativeDepth(
      makeData({
        creativeAssets: {
          totalAssets: 10,
          activeAssets: 8,
          averageScore: 60,
          fatigueRate: 0.15,
          topPerformerCount: 3,
          bottomPerformerCount: 1,
          diversityScore: 55,
        },
      }),
    );

    expect(result.breakdown).toBeDefined();
    expect(result.breakdown!["volume"]).toBeDefined();
    expect(result.breakdown!["diversity"]).toBe(55);
    expect(result.breakdown!["quality"]).toBe(60);
    expect(result.breakdown!["fatigue"]).toBeDefined();
  });

  it("clamps score to 0-100 range", () => {
    const result = scoreCreativeDepth(
      makeData({
        creativeAssets: {
          totalAssets: 20,
          activeAssets: 18,
          averageScore: 95,
          fatigueRate: 0.0,
          topPerformerCount: 15,
          bottomPerformerCount: 0,
          diversityScore: 95,
        },
      }),
    );

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
