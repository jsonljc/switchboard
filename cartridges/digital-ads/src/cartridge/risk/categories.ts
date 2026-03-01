// ---------------------------------------------------------------------------
// Risk Categories
// ---------------------------------------------------------------------------
// Computes RiskInput for each action type. Read actions have low/no risk;
// write actions compute risk based on budget impact and entity state.
// ---------------------------------------------------------------------------

import type { RiskInput } from "../types.js";

export function computeRiskInput(
  actionType: string,
  parameters: Record<string, unknown>,
  context?: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    // ── Read actions ──────────────────────────────────────────────────
    case "digital-ads.platform.connect":
    case "digital-ads.health.check":
      return readRisk("none");

    case "digital-ads.funnel.diagnose":
    case "digital-ads.snapshot.fetch":
    case "digital-ads.structure.analyze":
      return readRisk("low");

    case "digital-ads.portfolio.diagnose": {
      const platforms = parameters.platforms;
      const platformCount = Array.isArray(platforms) ? platforms.length : 0;
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: platformCount },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    }

    // ── Write actions ─────────────────────────────────────────────────
    case "digital-ads.campaign.pause":
    case "digital-ads.adset.pause":
      return computePauseRiskInput(context);

    case "digital-ads.campaign.resume":
    case "digital-ads.adset.resume":
      return computePauseRiskInput(context);

    case "digital-ads.campaign.adjust_budget":
    case "digital-ads.adset.adjust_budget":
      return computeBudgetRiskInput(parameters, context);

    case "digital-ads.targeting.modify":
      return computeTargetingRiskInput(parameters, context);

    default:
      return readRisk("low");
  }
}

function readRisk(baseRisk: "none" | "low"): RiskInput {
  return {
    baseRisk,
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

export function computePauseRiskInput(context?: Record<string, unknown>): RiskInput {
  const dailyBudget = Number(context?.currentBudget ?? 0);
  return {
    baseRisk: "medium",
    exposure: {
      dollarsAtRisk: dailyBudget,
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: {
      entityVolatile: false,
      learningPhase: false,
      recentlyModified: false,
    },
  };
}

export function computeBudgetRiskInput(
  parameters: Record<string, unknown>,
  context?: Record<string, unknown>,
): RiskInput {
  const currentBudget = Number(context?.currentBudget ?? 0);
  const newBudget = Number(parameters.newBudget ?? currentBudget);
  const endTime = context?.endTime as string | undefined;

  let remainingDays = 30;
  if (endTime) {
    const msRemaining = new Date(endTime).getTime() - Date.now();
    remainingDays = Math.max(1, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  }

  const budgetChange = Math.abs(newBudget - currentBudget);
  const dollarsAtRisk = budgetChange * remainingDays;
  const deliveryStatus = context?.deliveryStatus as string | undefined;

  return {
    baseRisk: "high",
    exposure: {
      dollarsAtRisk,
      blastRadius: 1,
    },
    reversibility: "full",
    sensitivity: {
      entityVolatile: deliveryStatus !== "ACTIVE" && deliveryStatus !== undefined,
      learningPhase: deliveryStatus === "LEARNING",
      recentlyModified: false,
    },
  };
}

export function computeTargetingRiskInput(
  parameters: Record<string, unknown>,
  context?: Record<string, unknown>,
): RiskInput {
  const dailyBudget = Number(context?.currentBudget ?? 0);
  const endTime = context?.endTime as string | undefined;
  const audienceSize = Number(parameters.audienceSize ?? 0);

  let remainingDays = 30;
  if (endTime) {
    const msRemaining = new Date(endTime).getTime() - Date.now();
    remainingDays = Math.max(1, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  }

  return {
    baseRisk: "high",
    exposure: {
      dollarsAtRisk: dailyBudget * remainingDays,
      blastRadius: audienceSize > 0 ? audienceSize / 1000 : 1,
    },
    reversibility: "partial",
    sensitivity: {
      entityVolatile: false,
      learningPhase: true,
      recentlyModified: false,
    },
  };
}
