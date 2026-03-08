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

    // ── Phase 1-2: Read-only actions ────────────────────────────
    case "digital-ads.report.performance":
    case "digital-ads.report.creative":
    case "digital-ads.report.audience":
    case "digital-ads.report.placement":
    case "digital-ads.report.comparison":
    case "digital-ads.auction.insights":
    case "digital-ads.signal.pixel.diagnose":
    case "digital-ads.signal.capi.diagnose":
    case "digital-ads.signal.emq.check":
    case "digital-ads.account.learning_phase":
    case "digital-ads.account.delivery.diagnose":
    case "digital-ads.audience.list":
    case "digital-ads.audience.insights":
    case "digital-ads.budget.recommend":
    case "digital-ads.creative.list":
    case "digital-ads.creative.analyze":
    case "digital-ads.creative.generate":
    case "digital-ads.creative.score_assets":
    case "digital-ads.creative.generate_brief":
    case "digital-ads.experiment.check":
    case "digital-ads.experiment.list":
    case "digital-ads.optimization.review":
    case "digital-ads.rule.list":
    case "digital-ads.strategy.recommend":
    case "digital-ads.strategy.mediaplan":
    case "digital-ads.reach.estimate":
      return readRisk("low");

    // ── Phase 3: Audience writes ────────────────────────────────
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

    // ── Phase 4: Bid & Budget writes ────────────────────────────
    case "digital-ads.bid.update_strategy":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: Number(context?.currentBudget ?? 0), blastRadius: 1 },
        reversibility: "full",
        sensitivity: {
          entityVolatile: false,
          learningPhase: true,
          recentlyModified: false,
        },
      };

    case "digital-ads.budget.reallocate":
      return computeBudgetRiskInput(parameters, context);

    case "digital-ads.schedule.set":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

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

    // ── Phase 5: Creative writes ────────────────────────────────
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

    // ── Phase 6: Experiment writes ──────────────────────────────
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

    // ── Phase 7: Optimization & Rule writes ─────────────────────
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

    // ── Phase 8: Strategy writes ────────────────────────────────
    case "digital-ads.campaign.setup_guided":
      return {
        baseRisk: "high",
        exposure: { dollarsAtRisk: Number(parameters.dailyBudget ?? 0) * 30, blastRadius: 3 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Phase 9: Compliance & Brand Safety ────────────────────────
    case "digital-ads.compliance.review_status":
    case "digital-ads.compliance.audit":
      return readRisk("low");

    case "digital-ads.compliance.publisher_blocklist":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    case "digital-ads.compliance.content_exclusions":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Phase 9: Measurement & Attribution ────────────────────────
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

    // ── Phase 10-13: Read-only actions ────────────────────────────
    case "digital-ads.pacing.check":
    case "digital-ads.alert.anomaly_scan":
    case "digital-ads.alert.budget_forecast":
    case "digital-ads.alert.policy_scan":
    case "digital-ads.alert.send_notifications":
    case "digital-ads.forecast.budget_scenario":
    case "digital-ads.forecast.diminishing_returns":
    case "digital-ads.plan.annual":
    case "digital-ads.plan.quarterly":
    case "digital-ads.catalog.health":
      return readRisk("low");

    // ── Phase 14: Notification writes ──────────────────────────────
    case "digital-ads.alert.configure_notifications":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Phase 10: Pacing writes ────────────────────────────────────
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

    // ── Phase 13: Catalog writes ──────────────────────────────────
    case "digital-ads.catalog.product_sets":
      return {
        baseRisk: "medium",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Phase 15: Creative Testing Queue ────────────────────────────
    case "digital-ads.creative.test_queue":
    case "digital-ads.creative.test_evaluate":
    case "digital-ads.creative.power_calculate":
      return readRisk("low");

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

    // ── Custom KPI ───────────────────────────────────────────────────
    case "digital-ads.kpi.list":
    case "digital-ads.kpi.compute":
      return readRisk("low");

    case "digital-ads.kpi.register":
    case "digital-ads.kpi.remove":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

    // ── Cross-Platform Deduplication ────────────────────────────────
    case "digital-ads.deduplication.analyze":
    case "digital-ads.deduplication.estimate_overlap":
      return readRisk("low");

    // ── Phase 16: Account Memory ─────────────────────────────────
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

    // ── Geo-Holdout Experiments ────────────────────────────────────
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

    // ── Multi-Touch Attribution ──────────────────────────────────────
    case "digital-ads.attribution.multi_touch":
    case "digital-ads.attribution.compare_models":
    case "digital-ads.attribution.channel_roles":
      return readRisk("low");

    // ── LTV Optimization ─────────────────────────────────────────────
    case "digital-ads.ltv.project":
    case "digital-ads.ltv.optimize":
    case "digital-ads.ltv.allocate":
      return readRisk("low");

    // ── Seasonality ────────────────────────────────────────────────────
    case "digital-ads.seasonal.calendar":
    case "digital-ads.seasonal.events":
      return readRisk("low");

    case "digital-ads.seasonal.add_event":
      return {
        baseRisk: "low",
        exposure: { dollarsAtRisk: 0, blastRadius: 1 },
        reversibility: "full",
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      };

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
