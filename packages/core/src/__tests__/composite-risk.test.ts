import { describe, it, expect } from "vitest";
import {
  computeCompositeRiskAdjustment,
  DEFAULT_COMPOSITE_RISK_CONFIG,
} from "../engine/risk-scorer.js";
import type { RiskScore, CompositeRiskContext } from "@switchboard/schemas";

function makeBaseScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    rawScore: 35,
    category: "low",
    factors: [
      {
        factor: "base_risk",
        weight: 35,
        contribution: 35,
        detail: "Base risk category: medium",
      },
    ],
    ...overrides,
  };
}

function makeCompositeContext(
  overrides: Partial<CompositeRiskContext> = {},
): CompositeRiskContext {
  return {
    recentActionCount: 0,
    windowMs: 3600000,
    cumulativeExposure: 0,
    distinctTargetEntities: 0,
    distinctCartridges: 1,
    ...overrides,
  };
}

describe("Composite Risk Adjustment", () => {
  it("no composite context values → no adjustment", () => {
    const base = makeBaseScore();
    const context = makeCompositeContext();
    const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(
      base,
      context,
    );
    expect(adjustedScore.rawScore).toBe(base.rawScore);
    expect(adjustedScore.category).toBe(base.category);
    expect(compositeFactors).toHaveLength(0);
  });

  it("high cumulative exposure → score bumps up", () => {
    const base = makeBaseScore({ rawScore: 35, category: "low" });
    const context = makeCompositeContext({
      recentActionCount: 10,
      cumulativeExposure: 50000,
    });
    const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(
      base,
      context,
    );
    expect(adjustedScore.rawScore).toBeGreaterThan(35);
    const exposureFactor = compositeFactors.find(
      (f) => f.factor === "cumulative_exposure",
    );
    expect(exposureFactor).toBeDefined();
    expect(exposureFactor!.contribution).toBe(DEFAULT_COMPOSITE_RISK_CONFIG.cumulativeExposureWeight);
  });

  it("high velocity → score bumps up", () => {
    const base = makeBaseScore({ rawScore: 35, category: "low" });
    const context = makeCompositeContext({
      recentActionCount: 40, // 2x the threshold of 20
      distinctTargetEntities: 40,
    });
    const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(
      base,
      context,
    );
    expect(adjustedScore.rawScore).toBeGreaterThan(35);
    const velocityFactor = compositeFactors.find(
      (f) => f.factor === "action_velocity",
    );
    expect(velocityFactor).toBeDefined();
    expect(velocityFactor!.contribution).toBeGreaterThan(0);
  });

  it("concentration risk (many actions, few targets) → penalty", () => {
    const base = makeBaseScore({ rawScore: 35, category: "low" });
    const context = makeCompositeContext({
      recentActionCount: 20,
      distinctTargetEntities: 2, // 2/20 = 0.1 ratio → concentration = 0.9
    });
    const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
    const concentrationFactor = compositeFactors.find(
      (f) => f.factor === "concentration_risk",
    );
    expect(concentrationFactor).toBeDefined();
    expect(concentrationFactor!.contribution).toBeGreaterThan(0);
  });

  it("cross-cartridge spread → penalty", () => {
    const base = makeBaseScore({ rawScore: 35, category: "low" });
    const context = makeCompositeContext({
      recentActionCount: 5,
      distinctCartridges: 4,
    });
    const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
    const crossCartridgeFactor = compositeFactors.find(
      (f) => f.factor === "cross_cartridge_risk",
    );
    expect(crossCartridgeFactor).toBeDefined();
    expect(crossCartridgeFactor!.contribution).toBeGreaterThan(0);
  });

  it("multiple factors stack additively", () => {
    const base = makeBaseScore({ rawScore: 35, category: "low" });
    const context = makeCompositeContext({
      recentActionCount: 40,
      cumulativeExposure: 50000,
      distinctTargetEntities: 2,
      distinctCartridges: 4,
    });
    const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(
      base,
      context,
    );
    // Should have multiple factors
    expect(compositeFactors.length).toBeGreaterThanOrEqual(3);
    // Score should increase significantly
    expect(adjustedScore.rawScore).toBeGreaterThan(50);
  });

  it("score capped at 100", () => {
    const base = makeBaseScore({ rawScore: 90, category: "critical" });
    const context = makeCompositeContext({
      recentActionCount: 100,
      cumulativeExposure: 500000,
      distinctTargetEntities: 1,
      distinctCartridges: 10,
    });
    const { adjustedScore } = computeCompositeRiskAdjustment(base, context);
    expect(adjustedScore.rawScore).toBeLessThanOrEqual(100);
  });

  it("category re-derived correctly after adjustment", () => {
    // Start at low (score 35), with enough composite penalties to push to medium (41-60)
    const base = makeBaseScore({ rawScore: 35, category: "low" });
    const context = makeCompositeContext({
      recentActionCount: 5,
      cumulativeExposure: 25000, // 50% of threshold → 7.5 contribution
      distinctCartridges: 4, // 3 extra → 5 contribution
    });
    const { adjustedScore } = computeCompositeRiskAdjustment(base, context);
    // 35 + 7.5 + 5 = 47.5 → medium
    expect(adjustedScore.rawScore).toBeGreaterThan(40);
    expect(adjustedScore.category).toBe("medium");
  });

  it("uses custom config when provided", () => {
    const base = makeBaseScore({ rawScore: 35, category: "low" });
    const context = makeCompositeContext({
      cumulativeExposure: 100,
    });
    const customConfig = {
      ...DEFAULT_COMPOSITE_RISK_CONFIG,
      cumulativeExposureWeight: 50,
      cumulativeExposureThreshold: 100,
    };
    const { adjustedScore } = computeCompositeRiskAdjustment(
      base,
      context,
      customConfig,
    );
    // 35 + 50 = 85 → critical
    expect(adjustedScore.rawScore).toBe(85);
    expect(adjustedScore.category).toBe("critical");
  });
});
