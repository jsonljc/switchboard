// ---------------------------------------------------------------------------
// Constants, type guards, and shared helpers for the DigitalAdsCartridge
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { PlatformType } from "../platforms/types.js";
import type { VerticalType } from "../core/types.js";
import type { ActionHandler } from "./actions/handler-context.js";

// Domain handler registries
import { reportingHandlers } from "./actions/reporting-handlers.js";
import { signalHealthHandlers } from "./actions/signal-health-handlers.js";
import { audienceHandlers } from "./actions/audience-handlers.js";
import { creativeHandlers } from "./actions/creative-handlers.js";
import { creativeTestingHandlers } from "./actions/creative-testing-handlers.js";
import { experimentHandlers } from "./actions/experiment-handlers.js";
import { budgetOptimizationHandlers } from "./actions/budget-optimization-handlers.js";
import { strategyHandlers } from "./actions/strategy-handlers.js";
import { complianceHandlers } from "./actions/compliance-handlers.js";
import { measurementHandlers } from "./actions/measurement-handlers.js";
import { pacingHandlers } from "./actions/pacing-handlers.js";
import { alertingHandlers } from "./actions/alerting-handlers.js";
import { forecastingHandlers } from "./actions/forecasting-handlers.js";
import { deduplicationHandlers } from "./actions/deduplication-handlers.js";
import { memoryHandlers } from "./actions/memory-handlers.js";
import { geoExperimentHandlers } from "./actions/geo-experiment-handlers.js";
import { kpiSeasonalHandlers } from "./actions/kpi-seasonal-handlers.js";
import { guidedSetupHandlers } from "./actions/guided-setup-handlers.js";

// ---------------------------------------------------------------------------
// Platform / vertical validation sets
// ---------------------------------------------------------------------------

const VALID_PLATFORMS = new Set<string>(["meta", "google", "tiktok"]);
const VALID_VERTICALS = new Set<string>(["commerce", "leadgen", "brand"]);

export function isPlatformType(v: unknown): v is PlatformType {
  return typeof v === "string" && VALID_PLATFORMS.has(v);
}

export function isVerticalType(v: unknown): v is VerticalType {
  return typeof v === "string" && VALID_VERTICALS.has(v);
}

// ---------------------------------------------------------------------------
// Read action set — used to distinguish read vs write dispatch
// ---------------------------------------------------------------------------

export const READ_ACTIONS = new Set<string>([
  "digital-ads.platform.connect",
  "digital-ads.funnel.diagnose",
  "digital-ads.portfolio.diagnose",
  "digital-ads.snapshot.fetch",
  "digital-ads.structure.analyze",
  "digital-ads.health.check",
  "digital-ads.report.performance",
  "digital-ads.report.creative",
  "digital-ads.report.audience",
  "digital-ads.report.placement",
  "digital-ads.report.comparison",
  "digital-ads.auction.insights",
  "digital-ads.signal.pixel.diagnose",
  "digital-ads.signal.capi.diagnose",
  "digital-ads.signal.emq.check",
  "digital-ads.account.learning_phase",
  "digital-ads.account.delivery.diagnose",
  "digital-ads.audience.list",
  "digital-ads.audience.insights",
  "digital-ads.budget.recommend",
  "digital-ads.creative.list",
  "digital-ads.creative.analyze",
  "digital-ads.creative.generate",
  "digital-ads.creative.score_assets",
  "digital-ads.creative.generate_brief",
  "digital-ads.experiment.check",
  "digital-ads.experiment.list",
  "digital-ads.optimization.review",
  "digital-ads.rule.list",
  "digital-ads.strategy.recommend",
  "digital-ads.strategy.mediaplan",
  "digital-ads.reach.estimate",
  "digital-ads.compliance.review_status",
  "digital-ads.compliance.audit",
  "digital-ads.measurement.lift_study.check",
  "digital-ads.measurement.attribution.compare",
  "digital-ads.measurement.mmm_export",
  "digital-ads.attribution.multi_touch",
  "digital-ads.attribution.compare_models",
  "digital-ads.attribution.channel_roles",
  "digital-ads.pacing.check",
  "digital-ads.alert.anomaly_scan",
  "digital-ads.alert.budget_forecast",
  "digital-ads.alert.policy_scan",
  "digital-ads.alert.send_notifications",
  "digital-ads.forecast.budget_scenario",
  "digital-ads.forecast.diminishing_returns",
  "digital-ads.plan.annual",
  "digital-ads.plan.quarterly",
  "digital-ads.catalog.health",
  "digital-ads.creative.test_queue",
  "digital-ads.creative.test_evaluate",
  "digital-ads.creative.power_calculate",
  "digital-ads.kpi.list",
  "digital-ads.kpi.compute",
  "digital-ads.deduplication.analyze",
  "digital-ads.deduplication.estimate_overlap",
  "digital-ads.geo_experiment.design",
  "digital-ads.geo_experiment.analyze",
  "digital-ads.geo_experiment.power",
  "digital-ads.memory.insights",
  "digital-ads.memory.list",
  "digital-ads.memory.recommend",
  "digital-ads.memory.export",
  "digital-ads.ltv.project",
  "digital-ads.ltv.optimize",
  "digital-ads.ltv.allocate",
  "digital-ads.seasonal.calendar",
  "digital-ads.seasonal.events",
]);

// ---------------------------------------------------------------------------
// Shared result helpers
// ---------------------------------------------------------------------------

export function failResult(summary: string, step: string, error: string): ExecuteResult {
  return {
    success: false,
    summary,
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [{ step, error }],
    durationMs: 0,
    undoRecipe: null,
  };
}

// ---------------------------------------------------------------------------
// Combined handler registry — built once from all domain handler maps
// ---------------------------------------------------------------------------

export function buildHandlerRegistry(): Map<string, ActionHandler> {
  const registry = new Map<string, ActionHandler>();
  const sources: ReadonlyMap<string, ActionHandler>[] = [
    reportingHandlers,
    signalHealthHandlers,
    audienceHandlers,
    creativeHandlers,
    creativeTestingHandlers,
    experimentHandlers,
    budgetOptimizationHandlers,
    strategyHandlers,
    complianceHandlers,
    measurementHandlers,
    pacingHandlers,
    alertingHandlers,
    forecastingHandlers,
    deduplicationHandlers,
    memoryHandlers,
    geoExperimentHandlers,
    kpiSeasonalHandlers,
    guidedSetupHandlers,
  ];
  for (const source of sources) {
    for (const [key, handler] of source) {
      registry.set(key, handler);
    }
  }
  return registry;
}
