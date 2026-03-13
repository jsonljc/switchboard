import { describe, it, expect } from "vitest";
import {
  computeCompositeRiskAdjustment,
  DEFAULT_RISK_CONFIG,
  DEFAULT_COMPOSITE_RISK_CONFIG,
} from "../engine/risk-scorer.js";
import type { RiskScore, RiskCategory, CompositeRiskContext } from "@switchboard/schemas";
import type { CompositeRiskConfig } from "../engine/risk-scorer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeCompositeContext(overrides: Partial<CompositeRiskContext> = {}): CompositeRiskContext {
  return {
    recentActionCount: 0,
    windowMs: 3600000,
    cumulativeExposure: 0,
    distinctTargetEntities: 0,
    distinctCartridges: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeCompositeRiskAdjustment
// ---------------------------------------------------------------------------

describe("computeCompositeRiskAdjustment", () => {
  describe("cumulative exposure", () => {
    it("zero exposure produces no factor", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({ cumulativeExposure: 0 });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cumulative_exposure");
      expect(factor).toBeUndefined();
    });

    it("scales linearly up to threshold", () => {
      const base = makeBaseScore({ rawScore: 30, category: "low" });
      const context = makeCompositeContext({
        cumulativeExposure: 25000,
        recentActionCount: 5,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cumulative_exposure");
      expect(factor).toBeDefined();
      // 25000/50000 * 15 = 7.5
      expect(factor!.contribution).toBe(7.5);
    });

    it("caps at cumulativeExposureWeight when exceeding threshold", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        cumulativeExposure: 200000,
        recentActionCount: 10,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cumulative_exposure");
      expect(factor!.contribution).toBe(DEFAULT_COMPOSITE_RISK_CONFIG.cumulativeExposureWeight);
    });

    it("detail includes dollar amount and action count", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        cumulativeExposure: 5000,
        recentActionCount: 3,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cumulative_exposure");
      expect(factor!.detail).toContain("$5000.00");
      expect(factor!.detail).toContain("3 recent actions");
    });
  });

  describe("action velocity", () => {
    it("no penalty when action count is at or below threshold", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 20,
        distinctTargetEntities: 20,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "action_velocity");
      expect(factor).toBeUndefined();
    });

    it("applies penalty proportional to overage", () => {
      const base = makeBaseScore({ rawScore: 30, category: "low" });
      const context = makeCompositeContext({
        recentActionCount: 30,
        distinctTargetEntities: 30,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "action_velocity");
      expect(factor).toBeDefined();
      // overage = 10, overageRatio = 10/20 = 0.5, contribution = 0.5 * 10 = 5
      expect(factor!.contribution).toBe(5);
    });

    it("caps at velocityWeight", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 100,
        distinctTargetEntities: 100,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "action_velocity");
      expect(factor!.contribution).toBeLessThanOrEqual(
        DEFAULT_COMPOSITE_RISK_CONFIG.velocityWeight,
      );
    });

    it("detail includes action count and window", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 25,
        windowMs: 60000,
        distinctTargetEntities: 25,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "action_velocity");
      expect(factor!.detail).toContain("25 actions");
      expect(factor!.detail).toContain("60000ms");
    });
  });

  describe("concentration risk", () => {
    it("no penalty when only one action", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 1,
        distinctTargetEntities: 1,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "concentration_risk");
      expect(factor).toBeUndefined();
    });

    it("no penalty when distinctTargetEntities is zero", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 10,
        distinctTargetEntities: 0,
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "concentration_risk");
      expect(factor).toBeUndefined();
    });

    it("no penalty when concentration ratio is 0.5 or less", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 10,
        distinctTargetEntities: 5, // ratio = 1 - 5/10 = 0.5, exactly at threshold
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "concentration_risk");
      expect(factor).toBeUndefined();
    });

    it("applies penalty when concentration ratio exceeds 0.5", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 20,
        distinctTargetEntities: 2, // ratio = 1 - 2/20 = 0.9
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "concentration_risk");
      expect(factor).toBeDefined();
      // (0.9 - 0.5) * 2 * 5 = 0.4 * 2 * 5 = 4
      expect(factor!.contribution).toBe(4);
    });

    it("maximum concentration (1 target, many actions) approaches full weight", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        recentActionCount: 100,
        distinctTargetEntities: 1, // ratio = 1 - 1/100 = 0.99
      });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "concentration_risk");
      expect(factor).toBeDefined();
      // (0.99 - 0.5) * 2 * 5 = 0.49 * 2 * 5 = 4.9
      expect(factor!.contribution).toBeCloseTo(4.9, 1);
    });
  });

  describe("cross-cartridge risk", () => {
    it("no penalty when only 1 cartridge", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({ distinctCartridges: 1 });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cross_cartridge_risk");
      expect(factor).toBeUndefined();
    });

    it("applies penalty for 2 cartridges", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({ distinctCartridges: 2 });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cross_cartridge_risk");
      expect(factor).toBeDefined();
      // (2-1) * (5/3) = 1.6667
      expect(factor!.contribution).toBeCloseTo(5 / 3, 4);
    });

    it("caps at crossCartridgeWeight", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({ distinctCartridges: 10 });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cross_cartridge_risk");
      expect(factor!.contribution).toBeLessThanOrEqual(
        DEFAULT_COMPOSITE_RISK_CONFIG.crossCartridgeWeight,
      );
    });

    it("detail mentions distinct cartridges count", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({ distinctCartridges: 3 });
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context);
      const factor = compositeFactors.find((f) => f.factor === "cross_cartridge_risk");
      expect(factor!.detail).toContain("3 distinct cartridges");
    });
  });

  describe("adjusted score", () => {
    it("preserves base factors in adjusted score", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        cumulativeExposure: 10000,
        recentActionCount: 2,
      });
      const { adjustedScore } = computeCompositeRiskAdjustment(base, context);
      expect(adjustedScore.factors).toEqual(expect.arrayContaining(base.factors));
    });

    it("appends composite factors to adjusted score factors", () => {
      const base = makeBaseScore();
      const context = makeCompositeContext({
        cumulativeExposure: 10000,
        recentActionCount: 2,
        distinctCartridges: 3,
      });
      const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(base, context);
      expect(adjustedScore.factors.length).toBe(base.factors.length + compositeFactors.length);
    });

    it("caps adjusted score at 100", () => {
      const base = makeBaseScore({ rawScore: 95, category: "critical" });
      const context = makeCompositeContext({
        cumulativeExposure: 500000,
        recentActionCount: 100,
        distinctTargetEntities: 1,
        distinctCartridges: 10,
      });
      const { adjustedScore } = computeCompositeRiskAdjustment(base, context);
      expect(adjustedScore.rawScore).toBeLessThanOrEqual(100);
    });

    it("re-derives category after adjustment", () => {
      const base = makeBaseScore({ rawScore: 38, category: "low" });
      const context = makeCompositeContext({
        cumulativeExposure: 50000,
        recentActionCount: 5,
      });
      const { adjustedScore } = computeCompositeRiskAdjustment(base, context);
      // 38 + 15 = 53 -> medium
      expect(adjustedScore.rawScore).toBe(53);
      expect(adjustedScore.category).toBe("medium");
    });

    it("no factors means no adjustment", () => {
      const base = makeBaseScore({ rawScore: 50, category: "medium" });
      const context = makeCompositeContext();
      const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(base, context);
      expect(adjustedScore.rawScore).toBe(50);
      expect(adjustedScore.category).toBe("medium");
      expect(compositeFactors).toHaveLength(0);
    });
  });

  describe("custom composite config", () => {
    it("uses custom cumulativeExposureThreshold", () => {
      const base = makeBaseScore({ rawScore: 30, category: "low" });
      const context = makeCompositeContext({
        cumulativeExposure: 500,
        recentActionCount: 2,
      });
      const customConfig: CompositeRiskConfig = {
        ...DEFAULT_COMPOSITE_RISK_CONFIG,
        cumulativeExposureThreshold: 500,
        cumulativeExposureWeight: 20,
      };
      const { adjustedScore } = computeCompositeRiskAdjustment(base, context, customConfig);
      // 30 + 20 = 50
      expect(adjustedScore.rawScore).toBe(50);
    });

    it("uses custom velocityThreshold", () => {
      const base = makeBaseScore({ rawScore: 30, category: "low" });
      const context = makeCompositeContext({
        recentActionCount: 6,
        distinctTargetEntities: 6,
      });
      const customConfig: CompositeRiskConfig = {
        ...DEFAULT_COMPOSITE_RISK_CONFIG,
        velocityThreshold: 5,
        velocityWeight: 20,
      };
      const { compositeFactors } = computeCompositeRiskAdjustment(base, context, customConfig);
      const factor = compositeFactors.find((f) => f.factor === "action_velocity");
      expect(factor).toBeDefined();
      // overage = 1, overageRatio = min(1, 1/5) = 0.2, contribution = 0.2 * 20 = 4
      expect(factor!.contribution).toBe(4);
    });
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_RISK_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_RISK_CONFIG", () => {
  it("has all risk categories defined in baseWeights", () => {
    const categories: RiskCategory[] = ["none", "low", "medium", "high", "critical"];
    for (const cat of categories) {
      expect(DEFAULT_RISK_CONFIG.baseWeights[cat]).toBeDefined();
      expect(typeof DEFAULT_RISK_CONFIG.baseWeights[cat]).toBe("number");
    }
  });

  it("has positive penalty values", () => {
    expect(DEFAULT_RISK_CONFIG.exposureWeight).toBeGreaterThan(0);
    expect(DEFAULT_RISK_CONFIG.exposureDollarThreshold).toBeGreaterThan(0);
    expect(DEFAULT_RISK_CONFIG.blastRadiusWeight).toBeGreaterThan(0);
    expect(DEFAULT_RISK_CONFIG.irreversibilityPenalty).toBeGreaterThan(0);
    expect(DEFAULT_RISK_CONFIG.volatilityPenalty).toBeGreaterThan(0);
    expect(DEFAULT_RISK_CONFIG.learningPenalty).toBeGreaterThan(0);
    expect(DEFAULT_RISK_CONFIG.cooldownPenalty).toBeGreaterThan(0);
  });
});

describe("DEFAULT_COMPOSITE_RISK_CONFIG", () => {
  it("has positive thresholds and weights", () => {
    expect(DEFAULT_COMPOSITE_RISK_CONFIG.cumulativeExposureWeight).toBeGreaterThan(0);
    expect(DEFAULT_COMPOSITE_RISK_CONFIG.cumulativeExposureThreshold).toBeGreaterThan(0);
    expect(DEFAULT_COMPOSITE_RISK_CONFIG.velocityWeight).toBeGreaterThan(0);
    expect(DEFAULT_COMPOSITE_RISK_CONFIG.velocityThreshold).toBeGreaterThan(0);
    expect(DEFAULT_COMPOSITE_RISK_CONFIG.concentrationWeight).toBeGreaterThan(0);
    expect(DEFAULT_COMPOSITE_RISK_CONFIG.crossCartridgeWeight).toBeGreaterThan(0);
  });
});
