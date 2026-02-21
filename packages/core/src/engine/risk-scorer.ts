import type {
  RiskCategory,
  RiskInput,
  RiskScore,
  RiskFactor,
} from "@switchboard/schemas";

export interface RiskScoringConfig {
  baseWeights: Record<RiskCategory, number>;
  exposureWeight: number;
  exposureDollarThreshold: number;
  blastRadiusWeight: number;
  irreversibilityPenalty: number;
  volatilityPenalty: number;
  learningPenalty: number;
  cooldownPenalty: number;
}

export const DEFAULT_RISK_CONFIG: RiskScoringConfig = {
  baseWeights: {
    none: 0,
    low: 15,
    medium: 35,
    high: 55,
    critical: 80,
  },
  exposureWeight: 20,
  exposureDollarThreshold: 10000,
  blastRadiusWeight: 10,
  irreversibilityPenalty: 15,
  volatilityPenalty: 8,
  learningPenalty: 10,
  cooldownPenalty: 5,
};

function scoreToCategory(score: number): RiskCategory {
  if (score <= 20) return "none";
  if (score <= 40) return "low";
  if (score <= 60) return "medium";
  if (score <= 80) return "high";
  return "critical";
}

export function computeRiskScore(
  input: RiskInput,
  config: RiskScoringConfig = DEFAULT_RISK_CONFIG,
): RiskScore {
  const factors: RiskFactor[] = [];
  let rawScore = 0;

  // Base risk weight
  const baseWeight = config.baseWeights[input.baseRisk];
  factors.push({
    factor: "base_risk",
    weight: baseWeight,
    contribution: baseWeight,
    detail: `Base risk category: ${input.baseRisk}`,
  });
  rawScore += baseWeight;

  // Exposure: dollars at risk
  const dollarContribution = Math.min(
    config.exposureWeight,
    (input.exposure.dollarsAtRisk / config.exposureDollarThreshold) * config.exposureWeight,
  );
  factors.push({
    factor: "dollars_at_risk",
    weight: config.exposureWeight,
    contribution: dollarContribution,
    detail: `$${input.exposure.dollarsAtRisk.toFixed(2)} at risk (threshold: $${config.exposureDollarThreshold})`,
  });
  rawScore += dollarContribution;

  // Exposure: blast radius
  if (input.exposure.blastRadius > 1) {
    const blastContribution =
      config.blastRadiusWeight * Math.log2(input.exposure.blastRadius);
    const cappedBlast = Math.min(config.blastRadiusWeight * 2, blastContribution);
    factors.push({
      factor: "blast_radius",
      weight: config.blastRadiusWeight,
      contribution: cappedBlast,
      detail: `Blast radius: ${input.exposure.blastRadius} entities`,
    });
    rawScore += cappedBlast;
  }

  // Reversibility
  if (input.reversibility === "none") {
    factors.push({
      factor: "irreversibility",
      weight: config.irreversibilityPenalty,
      contribution: config.irreversibilityPenalty,
      detail: "Action is not reversible",
    });
    rawScore += config.irreversibilityPenalty;
  } else if (input.reversibility === "partial") {
    const partialPenalty = config.irreversibilityPenalty * 0.5;
    factors.push({
      factor: "partial_reversibility",
      weight: config.irreversibilityPenalty,
      contribution: partialPenalty,
      detail: "Action is only partially reversible",
    });
    rawScore += partialPenalty;
  }

  // Sensitivity: entity volatile
  if (input.sensitivity.entityVolatile) {
    factors.push({
      factor: "entity_volatile",
      weight: config.volatilityPenalty,
      contribution: config.volatilityPenalty,
      detail: "Target entity is in an unstable state",
    });
    rawScore += config.volatilityPenalty;
  }

  // Sensitivity: learning phase
  if (input.sensitivity.learningPhase) {
    factors.push({
      factor: "learning_phase",
      weight: config.learningPenalty,
      contribution: config.learningPenalty,
      detail: "Target is in learning phase",
    });
    rawScore += config.learningPenalty;
  }

  // Sensitivity: recently modified
  if (input.sensitivity.recentlyModified) {
    factors.push({
      factor: "recently_modified",
      weight: config.cooldownPenalty,
      contribution: config.cooldownPenalty,
      detail: "Target was recently modified (cooldown active)",
    });
    rawScore += config.cooldownPenalty;
  }

  // Clamp to 0-100
  rawScore = Math.max(0, Math.min(100, rawScore));

  return {
    rawScore,
    category: scoreToCategory(rawScore),
    factors,
  };
}
