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
  // Delegate to category-specific handlers
  if (actionType.startsWith("digital-ads.report.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.signal.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.audience.")) {
    return handleAudienceActions(actionType);
  }
  if (actionType.startsWith("digital-ads.creative.")) {
    return handleCreativeActions(actionType, parameters);
  }
  if (actionType.startsWith("digital-ads.experiment.")) {
    return handleExperimentActions(actionType, parameters);
  }
  if (actionType.startsWith("digital-ads.compliance.")) {
    return handleComplianceActions(actionType);
  }
  if (actionType.startsWith("digital-ads.measurement.")) {
    return handleMeasurementActions(actionType, parameters);
  }
  if (actionType.startsWith("digital-ads.alert.")) return handleAlertActions(actionType);
  if (actionType.startsWith("digital-ads.pacing."))
    return handlePacingActions(actionType, parameters);
  if (actionType.startsWith("digital-ads.kpi.")) return handleKpiActions(actionType);
  if (actionType.startsWith("digital-ads.deduplication.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.geo_experiment.")) {
    return handleGeoExperimentActions(actionType, parameters);
  }
  if (actionType.startsWith("digital-ads.attribution.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.ltv.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.seasonal.")) return handleSeasonalActions(actionType);
  if (actionType.startsWith("digital-ads.memory.")) return handleMemoryActions(actionType);
  if (actionType.startsWith("digital-ads.campaign.")) {
    return handleCampaignActions(actionType, parameters, context);
  }
  if (actionType.startsWith("digital-ads.adset.")) {
    return handleAdSetActions(actionType, parameters, context);
  }
  if (actionType.startsWith("digital-ads.rule.")) return handleRuleActions(actionType);
  if (actionType.startsWith("digital-ads.budget.")) {
    return handleBudgetActions(actionType, parameters, context);
  }
  if (actionType.startsWith("digital-ads.optimization.")) {
    return handleOptimizationActions(actionType, parameters);
  }
  if (actionType.startsWith("digital-ads.strategy.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.account.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.forecast.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.plan.")) return readRisk("low");
  if (actionType.startsWith("digital-ads.catalog.")) return readRisk("low");

  // Handle special cases
  switch (actionType) {
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
    case "digital-ads.targeting.modify":
      return computeTargetingRiskInput(parameters, context);
    case "digital-ads.bid.update_strategy":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: Number(context?.currentBudget ?? 0), blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: true, recentlyModified: false },
      };
    case "digital-ads.schedule.set":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    case "digital-ads.reach.estimate":
      return readRisk("low");
    default:
      return readRisk("low");
  }
}

function handleCampaignActions(
  actionType: string,
  parameters: Record<string, unknown>,
  context?: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    case "digital-ads.campaign.pause":
    case "digital-ads.campaign.resume":
      return computePauseRiskInput(context);
    case "digital-ads.campaign.adjust_budget":
      return computeBudgetRiskInput(parameters, context);
    case "digital-ads.campaign.update_objective":
      return {
        baseRisk: "critical",
        exposure: {
          dollarsAtRisk: Number(context?.currentBudget ?? 0) * 30,
          blastRadius: 1,
        },
        reversibility: "none",
        sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: false },
      };
    case "digital-ads.campaign.setup_guided":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: Number(parameters.dailyBudget ?? 0) * 30, blastRadius: 3 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleAdSetActions(
  actionType: string,
  parameters: Record<string, unknown>,
  context?: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    case "digital-ads.adset.pause":
    case "digital-ads.adset.resume":
      return computePauseRiskInput(context);
    case "digital-ads.adset.adjust_budget":
      return computeBudgetRiskInput(parameters, context);
    default:
      return readRisk("low");
  }
}

function handleRuleActions(actionType: string): RiskInput {
  switch (actionType) {
    case "digital-ads.rule.list":
      return readRisk("low");
    case "digital-ads.rule.create":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    case "digital-ads.rule.delete":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "none",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleBudgetActions(
  actionType: string,
  parameters: Record<string, unknown>,
  context?: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    case "digital-ads.budget.recommend":
      return readRisk("low");
    case "digital-ads.budget.reallocate":
      return computeBudgetRiskInput(parameters, context);
    default:
      return readRisk("low");
  }
}

function handleOptimizationActions(
  actionType: string,
  parameters: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    case "digital-ads.optimization.review":
      return readRisk("low");
    case "digital-ads.optimization.apply":
      return {
        baseRisk: "high",
        exposure: {
          dollarsAtRisk: Number(parameters.totalBudgetAtRisk ?? 0),
          blastRadius: Number(parameters.actionCount ?? 1),
        },
        reversibility: "partial",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleAudienceActions(actionType: string): RiskInput {
  switch (actionType) {
    case "digital-ads.audience.list":
    case "digital-ads.audience.insights":
      return readRisk("low");
    case "digital-ads.audience.custom.create":
    case "digital-ads.audience.lookalike.create":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    case "digital-ads.audience.delete":
      return {
        baseRisk: "critical",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "none",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleCreativeActions(actionType: string, parameters: Record<string, unknown>): RiskInput {
  switch (actionType) {
    case "digital-ads.creative.list":
    case "digital-ads.creative.analyze":
    case "digital-ads.creative.generate":
    case "digital-ads.creative.score_assets":
    case "digital-ads.creative.generate_brief":
    case "digital-ads.creative.test_queue":
    case "digital-ads.creative.test_evaluate":
    case "digital-ads.creative.power_calculate":
      return readRisk("low");
    case "digital-ads.creative.upload":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    case "digital-ads.creative.rotate": {
      const adCount = Number(parameters.adCount ?? 1);
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: 0, blastRadius: adCount },
        reversibility: "partial",
        sensitivity: { entityVolatile: false, learningPhase: true, recentlyModified: false },
      };
    }
    case "digital-ads.creative.test_create":
      return {
        baseRisk: "medium",
        exposure: {
          dollarsAtRisk:
            Number(parameters.minBudgetPerVariant ?? 0) * Number(parameters.variantCount ?? 2),
          blastRadius: 1,
        },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    case "digital-ads.creative.test_conclude":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "partial",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleExperimentActions(
  actionType: string,
  parameters: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    case "digital-ads.experiment.check":
    case "digital-ads.experiment.list":
      return readRisk("low");
    case "digital-ads.experiment.create":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: Number(parameters.budget ?? 0), blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    case "digital-ads.experiment.conclude":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "partial",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleComplianceActions(actionType: string): RiskInput {
  switch (actionType) {
    case "digital-ads.compliance.review_status":
    case "digital-ads.compliance.audit":
      return readRisk("low");
    case "digital-ads.compliance.publisher_blocklist":
    case "digital-ads.compliance.content_exclusions":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleMeasurementActions(
  actionType: string,
  parameters: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    case "digital-ads.measurement.lift_study.check":
    case "digital-ads.measurement.attribution.compare":
    case "digital-ads.measurement.mmm_export":
      return readRisk("low");
    case "digital-ads.measurement.lift_study.create":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: Number(parameters.budget ?? 0), blastRadius: 1 },
        reversibility: "none",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleAlertActions(actionType: string): RiskInput {
  if (actionType === "digital-ads.alert.configure_notifications") {
    return {
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };
  }
  return readRisk("low");
}

function handlePacingActions(actionType: string, parameters: Record<string, unknown>): RiskInput {
  switch (actionType) {
    case "digital-ads.pacing.check":
      return readRisk("low");
    case "digital-ads.pacing.create_flight":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    case "digital-ads.pacing.auto_adjust":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: Number(parameters.totalBudget ?? 0), blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleKpiActions(actionType: string): RiskInput {
  if (actionType === "digital-ads.kpi.list" || actionType === "digital-ads.kpi.compute") {
    return readRisk("low");
  }
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  };
}

function handleGeoExperimentActions(
  actionType: string,
  parameters: Record<string, unknown>,
): RiskInput {
  switch (actionType) {
    case "digital-ads.geo_experiment.design":
    case "digital-ads.geo_experiment.analyze":
    case "digital-ads.geo_experiment.power":
      return readRisk("low");
    case "digital-ads.geo_experiment.create": {
      const budgetPerDay = Number(parameters.treatmentBudgetPerDay ?? 0);
      const testDays = Number(parameters.testDays ?? 0);
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: budgetPerDay * testDays, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    }
    case "digital-ads.geo_experiment.conclude":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "partial",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("low");
  }
}

function handleSeasonalActions(actionType: string): RiskInput {
  if (actionType === "digital-ads.seasonal.add_event") {
    return {
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };
  }
  return readRisk("low");
}

function handleMemoryActions(actionType: string): RiskInput {
  switch (actionType) {
    case "digital-ads.memory.insights":
    case "digital-ads.memory.list":
    case "digital-ads.memory.recommend":
    case "digital-ads.memory.export":
      return readRisk("none");
    case "digital-ads.memory.record":
    case "digital-ads.memory.record_outcome":
    case "digital-ads.memory.import":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };
    default:
      return readRisk("none");
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
