import { describe, it, expect } from "vitest";
import { computeRiskScore, DEFAULT_RISK_CONFIG } from "../engine/risk-scorer.js";
import type { RiskInput, RiskCategory } from "@switchboard/schemas";
import type { RiskScoringConfig } from "../engine/risk-scorer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRiskInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    baseRisk: "none",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeRiskScore
// ---------------------------------------------------------------------------

describe("computeRiskScore", () => {
  describe("base risk weighting", () => {
    it.each<[RiskCategory, number]>([
      ["none", 0],
      ["low", 15],
      ["medium", 35],
      ["high", 55],
      ["critical", 80],
    ])("baseRisk '%s' contributes %d", (category, expectedWeight) => {
      const result = computeRiskScore(makeRiskInput({ baseRisk: category }));
      const baseFactor = result.factors.find((f) => f.factor === "base_risk");
      expect(baseFactor).toBeDefined();
      expect(baseFactor!.contribution).toBe(expectedWeight);
      expect(baseFactor!.weight).toBe(expectedWeight);
      expect(baseFactor!.detail).toContain(category);
    });

    it("always includes base_risk as a factor even for 'none'", () => {
      const result = computeRiskScore(makeRiskInput({ baseRisk: "none" }));
      const baseFactor = result.factors.find((f) => f.factor === "base_risk");
      expect(baseFactor).toBeDefined();
      expect(baseFactor!.contribution).toBe(0);
    });
  });

  describe("dollar exposure", () => {
    it("contributes proportionally up to the threshold", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 5000, blastRadius: 1 } }),
      );
      const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
      expect(dollarFactor).toBeDefined();
      // 5000/10000 * 20 = 10
      expect(dollarFactor!.contribution).toBe(10);
    });

    it("caps at exposureWeight when dollars exceed threshold", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 50000, blastRadius: 1 } }),
      );
      const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
      expect(dollarFactor!.contribution).toBe(DEFAULT_RISK_CONFIG.exposureWeight);
    });

    it("exactly at threshold contributes full weight", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 10000, blastRadius: 1 } }),
      );
      const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
      expect(dollarFactor!.contribution).toBe(DEFAULT_RISK_CONFIG.exposureWeight);
    });

    it("zero dollars contributes zero", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 0, blastRadius: 1 } }),
      );
      const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
      expect(dollarFactor!.contribution).toBe(0);
    });

    it("includes formatted dollar detail string", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 1234.56, blastRadius: 1 } }),
      );
      const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
      expect(dollarFactor!.detail).toContain("$1234.56");
      expect(dollarFactor!.detail).toContain("threshold");
    });
  });

  describe("blast radius", () => {
    it("applies logarithmic scaling for blastRadius > 1", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 0, blastRadius: 4 } }),
      );
      const blastFactor = result.factors.find((f) => f.factor === "blast_radius");
      expect(blastFactor).toBeDefined();
      // log2(4) = 2, weight=10, contribution = 10*2 = 20, capped at 20
      expect(blastFactor!.contribution).toBe(20);
    });

    it("does not add blast_radius factor when blastRadius is 1", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 0, blastRadius: 1 } }),
      );
      const blastFactor = result.factors.find((f) => f.factor === "blast_radius");
      expect(blastFactor).toBeUndefined();
    });

    it("does not add blast_radius factor when blastRadius is 0", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 0, blastRadius: 0 } }),
      );
      const blastFactor = result.factors.find((f) => f.factor === "blast_radius");
      expect(blastFactor).toBeUndefined();
    });

    it("caps contribution at blastRadiusWeight * 2", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 0, blastRadius: 1024 } }),
      );
      const blastFactor = result.factors.find((f) => f.factor === "blast_radius");
      expect(blastFactor).toBeDefined();
      // log2(1024) = 10, weight=10, contribution = 100, capped at 20
      expect(blastFactor!.contribution).toBe(DEFAULT_RISK_CONFIG.blastRadiusWeight * 2);
    });

    it("small blast radius (2) gives modest contribution", () => {
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 0, blastRadius: 2 } }),
      );
      const blastFactor = result.factors.find((f) => f.factor === "blast_radius");
      expect(blastFactor).toBeDefined();
      // log2(2) = 1, weight=10, contribution = 10
      expect(blastFactor!.contribution).toBe(10);
    });
  });

  describe("reversibility", () => {
    it("reversibility 'none' applies full irreversibility penalty", () => {
      const result = computeRiskScore(makeRiskInput({ reversibility: "none" }));
      const factor = result.factors.find((f) => f.factor === "irreversibility");
      expect(factor).toBeDefined();
      expect(factor!.contribution).toBe(DEFAULT_RISK_CONFIG.irreversibilityPenalty);
      expect(factor!.detail).toContain("not reversible");
    });

    it("reversibility 'partial' applies half penalty", () => {
      const result = computeRiskScore(makeRiskInput({ reversibility: "partial" }));
      const factor = result.factors.find((f) => f.factor === "partial_reversibility");
      expect(factor).toBeDefined();
      expect(factor!.contribution).toBe(DEFAULT_RISK_CONFIG.irreversibilityPenalty * 0.5);
      expect(factor!.detail).toContain("partially reversible");
    });

    it("reversibility 'full' adds no penalty", () => {
      const result = computeRiskScore(makeRiskInput({ reversibility: "full" }));
      const irrevFactor = result.factors.find(
        (f) => f.factor === "irreversibility" || f.factor === "partial_reversibility",
      );
      expect(irrevFactor).toBeUndefined();
    });
  });

  describe("sensitivity flags", () => {
    it("entityVolatile adds volatility penalty", () => {
      const result = computeRiskScore(
        makeRiskInput({
          sensitivity: { entityVolatile: true, learningPhase: false, recentlyModified: false },
        }),
      );
      const factor = result.factors.find((f) => f.factor === "entity_volatile");
      expect(factor).toBeDefined();
      expect(factor!.contribution).toBe(DEFAULT_RISK_CONFIG.volatilityPenalty);
      expect(factor!.detail).toContain("unstable");
    });

    it("learningPhase adds learning penalty", () => {
      const result = computeRiskScore(
        makeRiskInput({
          sensitivity: { entityVolatile: false, learningPhase: true, recentlyModified: false },
        }),
      );
      const factor = result.factors.find((f) => f.factor === "learning_phase");
      expect(factor).toBeDefined();
      expect(factor!.contribution).toBe(DEFAULT_RISK_CONFIG.learningPenalty);
      expect(factor!.detail).toContain("learning phase");
    });

    it("recentlyModified adds cooldown penalty", () => {
      const result = computeRiskScore(
        makeRiskInput({
          sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: true },
        }),
      );
      const factor = result.factors.find((f) => f.factor === "recently_modified");
      expect(factor).toBeDefined();
      expect(factor!.contribution).toBe(DEFAULT_RISK_CONFIG.cooldownPenalty);
      expect(factor!.detail).toContain("cooldown");
    });

    it("no sensitivity flags adds no sensitivity penalties", () => {
      const result = computeRiskScore(makeRiskInput());
      const sensitivityFactors = result.factors.filter((f) =>
        ["entity_volatile", "learning_phase", "recently_modified"].includes(f.factor),
      );
      expect(sensitivityFactors).toHaveLength(0);
    });

    it("all sensitivity flags stack additively", () => {
      const result = computeRiskScore(
        makeRiskInput({
          sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
        }),
      );
      const sensitivityFactors = result.factors.filter((f) =>
        ["entity_volatile", "learning_phase", "recently_modified"].includes(f.factor),
      );
      expect(sensitivityFactors).toHaveLength(3);
      const totalSensitivity = sensitivityFactors.reduce((sum, f) => sum + f.contribution, 0);
      expect(totalSensitivity).toBe(
        DEFAULT_RISK_CONFIG.volatilityPenalty +
          DEFAULT_RISK_CONFIG.learningPenalty +
          DEFAULT_RISK_CONFIG.cooldownPenalty,
      );
    });
  });

  describe("score clamping and category mapping", () => {
    it("clamps rawScore to maximum of 100", () => {
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "critical",
          exposure: { dollarsAtRisk: 100000, blastRadius: 1024 },
          reversibility: "none",
          sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
        }),
      );
      expect(result.rawScore).toBe(100);
    });

    it("clamps rawScore to minimum of 0 (zero-risk input)", () => {
      const result = computeRiskScore(makeRiskInput({ baseRisk: "none" }));
      expect(result.rawScore).toBeGreaterThanOrEqual(0);
    });

    it("maps score 0 to 'none'", () => {
      const result = computeRiskScore(makeRiskInput({ baseRisk: "none" }));
      expect(result.rawScore).toBe(0);
      expect(result.category).toBe("none");
    });

    it("maps score 20 to 'none' (boundary)", () => {
      // baseRisk "low" = 15 + 5 from dollars
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "low",
          exposure: { dollarsAtRisk: 2500, blastRadius: 1 },
        }),
      );
      // 15 + (2500/10000)*20 = 15 + 5 = 20
      expect(result.rawScore).toBe(20);
      expect(result.category).toBe("none");
    });

    it("maps score 21 to 'low'", () => {
      // baseRisk "low" = 15 + 6 from dollars => 21
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "low",
          exposure: { dollarsAtRisk: 3000, blastRadius: 1 },
        }),
      );
      // 15 + (3000/10000)*20 = 15 + 6 = 21
      expect(result.rawScore).toBe(21);
      expect(result.category).toBe("low");
    });

    it("maps score 40 to 'low' (boundary)", () => {
      // baseRisk "medium" = 35 + 5 from dollars => 40
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "medium",
          exposure: { dollarsAtRisk: 2500, blastRadius: 1 },
        }),
      );
      expect(result.rawScore).toBe(40);
      expect(result.category).toBe("low");
    });

    it("maps score in 41-60 range to 'medium'", () => {
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "medium",
          exposure: { dollarsAtRisk: 5000, blastRadius: 1 },
        }),
      );
      // 35 + 10 = 45
      expect(result.rawScore).toBe(45);
      expect(result.category).toBe("medium");
    });

    it("maps score in 61-80 range to 'high'", () => {
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "high",
          exposure: { dollarsAtRisk: 5000, blastRadius: 1 },
        }),
      );
      // 55 + 10 = 65
      expect(result.rawScore).toBe(65);
      expect(result.category).toBe("high");
    });

    it("maps score 81 to 'critical'", () => {
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "critical",
          exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        }),
      );
      // 80 + (500/10000)*20 = 80 + 1 = 81
      expect(result.rawScore).toBe(81);
      expect(result.category).toBe("critical");
    });
  });

  describe("custom config", () => {
    it("uses custom baseWeights", () => {
      const config: RiskScoringConfig = {
        ...DEFAULT_RISK_CONFIG,
        baseWeights: {
          none: 0,
          low: 10,
          medium: 25,
          high: 40,
          critical: 60,
        },
      };
      const result = computeRiskScore(makeRiskInput({ baseRisk: "medium" }), config);
      const baseFactor = result.factors.find((f) => f.factor === "base_risk");
      expect(baseFactor!.contribution).toBe(25);
    });

    it("uses custom exposureDollarThreshold", () => {
      const config: RiskScoringConfig = {
        ...DEFAULT_RISK_CONFIG,
        exposureDollarThreshold: 1000,
      };
      const result = computeRiskScore(
        makeRiskInput({ exposure: { dollarsAtRisk: 500, blastRadius: 1 } }),
        config,
      );
      const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
      // 500/1000 * 20 = 10
      expect(dollarFactor!.contribution).toBe(10);
    });

    it("uses custom irreversibilityPenalty", () => {
      const config: RiskScoringConfig = {
        ...DEFAULT_RISK_CONFIG,
        irreversibilityPenalty: 30,
      };
      const result = computeRiskScore(makeRiskInput({ reversibility: "none" }), config);
      const factor = result.factors.find((f) => f.factor === "irreversibility");
      expect(factor!.contribution).toBe(30);
    });
  });

  describe("factor accumulation", () => {
    it("returns all factors in order", () => {
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "medium",
          exposure: { dollarsAtRisk: 5000, blastRadius: 4 },
          reversibility: "none",
          sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
        }),
      );
      const factorNames = result.factors.map((f) => f.factor);
      expect(factorNames).toEqual([
        "base_risk",
        "dollars_at_risk",
        "blast_radius",
        "irreversibility",
        "entity_volatile",
        "learning_phase",
        "recently_modified",
      ]);
    });

    it("rawScore equals the sum of all contributions (when under 100)", () => {
      const result = computeRiskScore(
        makeRiskInput({
          baseRisk: "low",
          exposure: { dollarsAtRisk: 1000, blastRadius: 2 },
          reversibility: "partial",
          sensitivity: { entityVolatile: true, learningPhase: false, recentlyModified: false },
        }),
      );
      const totalContribution = result.factors.reduce((sum, f) => sum + f.contribution, 0);
      expect(result.rawScore).toBe(totalContribution);
    });
  });
});
