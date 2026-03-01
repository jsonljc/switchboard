import { describe, it, expect } from "vitest";
import {
  computeStageEconomicImpact,
  computeDropoffEconomicImpact,
  buildElasticityRanking,
} from "../economic-impact.js";
import type { StageDiagnostic, FunnelDropoff } from "../../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(overrides: Partial<StageDiagnostic> = {}): StageDiagnostic {
  return {
    stageName: "purchase",
    metric: "purchase",
    currentValue: 80,
    previousValue: 100,
    delta: -20,
    deltaPercent: -20,
    isSignificant: true,
    severity: "warning",
    ...overrides,
  };
}

function makeDropoff(overrides: Partial<FunnelDropoff> = {}): FunnelDropoff {
  return {
    fromStage: "ATC",
    toStage: "purchase",
    currentRate: 0.3,
    previousRate: 0.4,
    deltaPercent: -25,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeStageEconomicImpact", () => {
  it("computes direct revenue impact for bottom-of-funnel stages", () => {
    const stage = makeStage({ currentValue: 80, previousValue: 100 });
    const aov = 50;

    const impact = computeStageEconomicImpact(stage, aov, true);

    expect(impact.conversionDelta).toBe(-20);
    expect(impact.estimatedRevenueDelta).toBe(-1000); // -20 * $50
    expect(impact.revenueImpactPercent).toBe(-20); // -1000 / 5000 * 100
  });

  it("attenuates impact for upper-funnel stages", () => {
    const stage = makeStage({
      stageName: "click",
      metric: "clicks",
      currentValue: 800,
      previousValue: 1000,
    });
    const aov = 50;

    const impact = computeStageEconomicImpact(stage, aov, false);

    // Upper funnel: -200 * 50 * 0.1 = -1000
    expect(impact.conversionDelta).toBe(-200);
    expect(impact.estimatedRevenueDelta).toBe(-1000);
  });

  it("uses smaller multiplier for impression-level stages", () => {
    const stage = makeStage({
      stageName: "awareness",
      metric: "impressions",
      currentValue: 80000,
      previousValue: 100000,
    });
    const aov = 50;

    const impact = computeStageEconomicImpact(stage, aov, false);

    // Impressions: -20000 * 50 * 0.01 = -10000
    expect(impact.conversionDelta).toBe(-20000);
    expect(impact.estimatedRevenueDelta).toBe(-10000);
  });

  it("handles zero previous value gracefully", () => {
    const stage = makeStage({ currentValue: 10, previousValue: 0, delta: 10, deltaPercent: 0 });
    const impact = computeStageEconomicImpact(stage, 50, true);

    expect(impact.conversionDelta).toBe(10);
    expect(impact.estimatedRevenueDelta).toBe(500);
    expect(impact.revenueImpactPercent).toBe(0); // no previous revenue to compare against
  });
});

describe("computeDropoffEconomicImpact", () => {
  it("computes revenue impact from rate changes", () => {
    const dropoff = makeDropoff({
      currentRate: 0.3,
      previousRate: 0.4,
    });

    const impact = computeDropoffEconomicImpact(dropoff, 100, 50);

    // Rate delta: 0.3 - 0.4 = -0.1
    // Conversion delta: -0.1 * 100 = -10
    // Revenue delta: -10 * 50 = -500
    expect(impact.conversionDelta).toBeCloseTo(-10);
    expect(impact.estimatedRevenueDelta).toBeCloseTo(-500);
  });

  it("handles zero expected conversions", () => {
    const dropoff = makeDropoff();
    const impact = computeDropoffEconomicImpact(dropoff, 0, 50);

    expect(impact.conversionDelta).toBeCloseTo(0);
    expect(impact.estimatedRevenueDelta).toBeCloseTo(0);
    expect(impact.revenueImpactPercent).toBeCloseTo(0);
  });
});

describe("buildElasticityRanking", () => {
  it("ranks stages by absolute revenue impact (worst first)", () => {
    const stages: StageDiagnostic[] = [
      makeStage({
        stageName: "click",
        metric: "clicks",
        economicImpact: { estimatedRevenueDelta: -500, conversionDelta: -10, revenueImpactPercent: -5 },
      }),
      makeStage({
        stageName: "purchase",
        metric: "purchase",
        economicImpact: { estimatedRevenueDelta: -2000, conversionDelta: -40, revenueImpactPercent: -20 },
      }),
      makeStage({
        stageName: "ATC",
        metric: "add_to_cart",
        economicImpact: { estimatedRevenueDelta: -800, conversionDelta: -16, revenueImpactPercent: -8 },
      }),
    ];

    const result = buildElasticityRanking(stages);

    expect(result.impactRanking).toHaveLength(3);
    expect(result.impactRanking[0].stage).toBe("purchase");
    expect(result.impactRanking[0].estimatedRevenueDelta).toBe(-2000);
    expect(result.impactRanking[1].stage).toBe("ATC");
    expect(result.impactRanking[2].stage).toBe("click");
    expect(result.totalEstimatedRevenueLoss).toBe(-3300);
  });

  it("excludes stages with positive or zero impact", () => {
    const stages: StageDiagnostic[] = [
      makeStage({
        stageName: "click",
        economicImpact: { estimatedRevenueDelta: 200, conversionDelta: 4, revenueImpactPercent: 2 },
      }),
      makeStage({
        stageName: "purchase",
        economicImpact: { estimatedRevenueDelta: -1000, conversionDelta: -20, revenueImpactPercent: -10 },
      }),
    ];

    const result = buildElasticityRanking(stages);

    expect(result.impactRanking).toHaveLength(1);
    expect(result.impactRanking[0].stage).toBe("purchase");
    expect(result.totalEstimatedRevenueLoss).toBe(-1000);
  });

  it("excludes non-significant stages", () => {
    const stages: StageDiagnostic[] = [
      makeStage({
        stageName: "click",
        isSignificant: false,
        economicImpact: { estimatedRevenueDelta: -500, conversionDelta: -10, revenueImpactPercent: -5 },
      }),
    ];

    const result = buildElasticityRanking(stages);

    expect(result.impactRanking).toHaveLength(0);
    expect(result.totalEstimatedRevenueLoss).toBe(0);
  });

  it("returns empty ranking when no stages have economic impact", () => {
    const stages: StageDiagnostic[] = [makeStage()];
    const result = buildElasticityRanking(stages);

    expect(result.impactRanking).toHaveLength(0);
    expect(result.totalEstimatedRevenueLoss).toBe(0);
  });
});
