// ---------------------------------------------------------------------------
// revenue-growth — Cyclic constraint-based revenue growth controller
// ---------------------------------------------------------------------------

// Cartridge
export { RevenueGrowthCartridge } from "./cartridge/index.js";
export { bootstrapRevenueGrowthCartridge } from "./cartridge/bootstrap.js";
export type {
  BootstrapRevenueGrowthConfig,
  BootstrapRevenueGrowthResult,
} from "./cartridge/bootstrap.js";
export { REVENUE_GROWTH_MANIFEST, REVENUE_GROWTH_ACTIONS } from "./cartridge/manifest.js";
export { DEFAULT_REVENUE_GROWTH_GUARDRAILS } from "./cartridge/defaults/guardrails.js";
export { DEFAULT_REVENUE_GROWTH_POLICIES } from "./cartridge/defaults/policies.js";

// Data foundation
export {
  collectNormalizedData,
  assignDataConfidenceTier,
  MockConnector,
} from "./data/normalizer.js";
export type { CartridgeConnector, DataCollectionDeps, RevGrowthDeps } from "./data/normalizer.js";
export { MetaAdsConnector } from "./data/meta-ads-connector.js";
export type { MetaAdsConnectorConfig } from "./data/meta-ads-connector.js";

// CRM data port
export { NullCrmAdapter, MockCrmAdapter, CrmConnector } from "./data/crm-data-port.js";
export type { CrmDataPort, CrmLead, CrmDeal, CrmStageConversion } from "./data/crm-data-port.js";

// Scorers
export { scoreSignalHealth } from "./scorers/signal-health.js";
export { scoreCreativeDepth } from "./scorers/creative-depth.js";
export { scoreFunnelLeakage } from "./scorers/funnel-leakage.js";
export { scoreHeadroom } from "./scorers/headroom.js";
export { scoreSalesProcess } from "./scorers/sales-process.js";

// Constraint engine
export { identifyConstraints } from "./constraint-engine/engine.js";
export type { ConstraintResult, ScorerContext } from "./constraint-engine/engine.js";

// Action engine
export {
  generateIntervention,
  generateInterventionWithLLM,
  estimateImpact,
  lookupActionType,
} from "./action-engine/engine.js";

// Planning
export { ActionPlanner } from "./planning/action-planner.js";
export type { PlannerContext } from "./planning/action-planner.js";
export { applyBudgetCap, validateSpendIncrease } from "./planning/budget-guardrails.js";
export type { BudgetLimits, BudgetCapResult } from "./planning/budget-guardrails.js";

// Execution
export { InterventionLifecycle } from "./execution/lifecycle.js";
export { determineEscalationLevel } from "./execution/escalation.js";
export { InMemoryDispatcher } from "./execution/dispatcher.js";
export type {
  InterventionDispatcher,
  GovernanceGate,
  DispatchResult,
} from "./execution/dispatcher.js";

// Learning
export { AccountProfileManager } from "./learning/account-profile.js";
export type { AccountProfileDeps } from "./learning/account-profile.js";

// Monitoring
export { PostChangeMonitor } from "./monitoring/post-change-monitor.js";

// Creative
export { analyzeCreativeGaps } from "./creative/gap-analysis.js";
export { generateCreativeStrategy } from "./creative/strategy-generator.js";
export type { CreativeStrategy, CreativeRecommendation } from "./creative/strategy-generator.js";
export { MockImageGenerator, OpenAIImageGenerator } from "./creative/image-generator.js";
export type {
  ImageGenerator,
  GeneratedImage,
  ImageGenerateOptions,
} from "./creative/image-generator.js";
export { AdReviewChecker } from "./creative/ad-review-checker.js";
export type {
  CreativeAssetForReview,
  AdReviewResult,
  AdReviewViolation,
} from "./creative/ad-review-checker.js";
export { CreativePipeline } from "./creative/pipeline.js";
export type { CreativePipelineDeps, CreativePipelineResult } from "./creative/pipeline.js";

// Campaign deployment
export { CampaignDeployer } from "./execution/campaign-deploy.js";
export type { CampaignConfig, CampaignDeployResult } from "./execution/campaign-deploy.js";

// Stores
export type {
  InterventionStore,
  DiagnosticCycleStore,
  DiagnosticCycleRecord,
  RevenueAccountStore,
  RevenueAccountRecord,
  WeeklyDigestStore,
  WeeklyDigestRecord,
  AccountProfileStore,
  MonitorCheckpointStore,
  TestCampaignStore,
} from "./stores/index.js";
export {
  InMemoryInterventionStore,
  InMemoryDiagnosticCycleStore,
  InMemoryRevenueAccountStore,
  InMemoryWeeklyDigestStore,
  InMemoryAccountProfileStore,
  InMemoryMonitorCheckpointStore,
  InMemoryTestCampaignStore,
} from "./stores/index.js";

// Outcome tracking
export { checkOutcomes } from "./outcome/tracker.js";
export type { OutcomeCheckResult } from "./outcome/tracker.js";
export { calibrateFromHistory } from "./outcome/calibrator.js";
export type { CalibrationEntry } from "./outcome/calibrator.js";

// Digest
export { generateWeeklyDigest } from "./digest/generator.js";

// Agent
export { RevenueGrowthAgent } from "./agent/revenue-growth-agent.js";
