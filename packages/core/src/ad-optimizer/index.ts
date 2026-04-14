export { MetaAdsClient } from "./meta-ads-client.js";
export { MetaCAPIClient } from "./meta-capi-client.js";
export { analyzeFunnel } from "./funnel-analyzer.js";
export type { CrmFunnelData, FunnelBenchmarks, FunnelInput } from "./funnel-analyzer.js";
export { comparePeriods } from "./period-comparator.js";
export type { MetricSet } from "./period-comparator.js";
export { LearningPhaseGuard } from "./learning-phase-guard.js";
export type {
  CampaignLearningInput,
  PerformanceMetrics,
  PerformanceTargets,
} from "./learning-phase-guard.js";
export { diagnose } from "./metric-diagnostician.js";
export type { Diagnosis } from "./metric-diagnostician.js";
export { generateRecommendations } from "./recommendation-engine.js";
export type { RecommendationInput } from "./recommendation-engine.js";
export { AuditRunner } from "./audit-runner.js";
export type {
  AuditDependencies,
  AuditConfig,
  AdsClientInterface,
  CrmDataProvider,
} from "./audit-runner.js";
export { createWeeklyAuditCron, createDailyCheckCron } from "./inngest-functions.js";
export type { CronDependencies } from "./inngest-functions.js";
