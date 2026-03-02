import type { RiskInput } from "@switchboard/schemas";

export function computeContactSearchRiskInput(): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 0 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeDealListRiskInput(): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 0 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeActivityListRiskInput(): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 0 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computePipelineStatusRiskInput(): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 0 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeContactCreateRiskInput(): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeContactUpdateRiskInput(): RiskInput {
  return {
    baseRisk: "medium",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeDealCreateRiskInput(amountDollars: number): RiskInput {
  return {
    baseRisk: "medium",
    exposure: { dollarsAtRisk: amountDollars, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computeActivityLogRiskInput(): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "none",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}
