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
export type { AuditDependencies, AuditConfig, AdsClientInterface } from "./audit-runner.js";
export { createWeeklyAuditCron, createDailyCheckCron } from "./inngest-functions.js";
export type { CronDependencies } from "./inngest-functions.js";
export { parseLeadWebhook, fetchLeadDetail, extractFieldValue } from "./meta-leads-ingester.js";
export type { LeadData } from "./meta-leads-ingester.js";
export {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  refreshTokenIfNeeded,
} from "./facebook-oauth.js";
export type { FacebookOAuthConfig, TokenResult, AdAccount } from "./facebook-oauth.js";
export { buildConversionEvent } from "./crm-event-emitter.js";
export type { BuildConversionEventParams } from "./crm-event-emitter.js";
export { MetaCAPIDispatcher } from "./meta-capi-dispatcher.js";
export { MetaCampaignInsightsProvider } from "./meta-campaign-insights-provider.js";
export { LearningPhaseGuardV2 } from "./learning-phase-guard.js";
export { detectFunnelShape, getFunnelStageTemplate } from "./funnel-detector.js";
export { detectTrends, projectBreach, classifyTrendTier } from "./trend-engine.js";
export { analyzeBudgetDistribution, detectCBO } from "./budget-analyzer.js";
export { deduplicateCreatives, analyzeCreatives } from "./creative-analyzer.js";
export type { RawAdData } from "./creative-analyzer.js";
export { detectSaturation } from "./saturation-detector.js";
export * from "./lead-intake/index.js";
