// ---------------------------------------------------------------------------
// meta-ads — Multi-platform media performance diagnostic engine
// ---------------------------------------------------------------------------

// Core types
export type {
  FunnelSchema,
  FunnelStage,
  MetricSnapshot,
  StageMetrics,
  DiagnosticResult,
  StageDiagnostic,
  FunnelDropoff,
  Finding,
  Severity,
  VerticalType,
  EntityLevel,
  TimeRange,
  ComparisonPeriods,
  VerticalBenchmarks,
  StageBenchmark,
  SubEntityBreakdown,
  DiagnosticContext,
  EconomicImpact,
} from "./core/types.js";

// Analysis engine
export { analyzeFunnel } from "./core/analysis/funnel-walker.js";
export type { FindingAdvisor, FunnelWalkerOptions } from "./core/analysis/funnel-walker.js";
export { buildComparisonPeriods, buildTrailingPeriods } from "./core/analysis/comparator.js";
export { isSignificantChange, zScore, percentChange } from "./core/analysis/significance.js";
export {
  chiSquaredTest,
  proportionTest,
  minimumSampleSize,
  confidenceInterval,
  isAdequateSampleSize,
  adjustedSignificance,
} from "./core/analysis/significance.js";
export {
  normalQuantile,
  erf,
  normalCDF,
  chi2CDF,
  wilsonScoreInterval,
} from "./core/analysis/stats-utils.js";
export { accountVariance, getEffectiveVariance } from "./core/analysis/thresholds.js";
export type { AccountHistory } from "./core/analysis/thresholds.js";
export {
  computeStageEconomicImpact,
  computeDropoffEconomicImpact,
  buildElasticityRanking,
} from "./core/analysis/economic-impact.js";
export { buildDiagnosticContext } from "./core/analysis/context-builder.js";
export type { ContextBuilderOptions } from "./core/analysis/context-builder.js";

// Seasonality
export {
  SEASONAL_EVENTS,
  getActiveSeasonalEvent,
  getSeasonalCPMMultiplier,
  dateRangesOverlap,
  ENHANCED_SEASONAL_EVENTS,
  getSeasonalEvents,
  getMonthlySeasonalProfile,
  getAnnualSeasonalCalendar,
  SeasonalCalendar,
} from "./core/analysis/seasonality.js";
export type {
  SeasonalEvent,
  EventCategory,
  EventRegion,
  EventVertical,
  EnhancedSeasonalEvent,
  SeasonalEventFilterOptions,
  MonthlySeasonalProfile,
  AnnualCalendarMonth,
} from "./core/analysis/seasonality.js";

// Platform types
export type {
  PlatformType,
  PlatformClient,
  PlatformCredentials,
  MetaCredentials,
  GoogleCredentials,
  TikTokCredentials,
  PlatformDiagnosticConfig,
} from "./platforms/types.js";
export { AbstractPlatformClient } from "./platforms/base-client.js";

// Platform clients
export { MetaApiClient } from "./platforms/meta/client.js";
export type { MetaApiConfig } from "./platforms/meta/types.js";
export { GoogleAdsClient } from "./platforms/google/client.js";
export type { GoogleAdsApiConfig } from "./platforms/google/types.js";
export { TikTokAdsClient } from "./platforms/tiktok/client.js";
export type { TikTokApiConfig } from "./platforms/tiktok/types.js";

// Platform registry
export { createPlatformClient, resolveFunnel, resolveBenchmarks } from "./platforms/registry.js";

// Platform funnels — Meta
export { commerceFunnel as metaCommerceFunnel } from "./platforms/meta/funnels/commerce.js";
export {
  leadgenFunnel as metaLeadgenFunnel,
  createLeadgenFunnel as createMetaLeadgenFunnel,
  DEFAULT_QUALIFIED_LEAD_ACTION,
} from "./platforms/meta/funnels/leadgen.js";

// Platform funnels — Google
export { commerceFunnel as googleCommerceFunnel } from "./platforms/google/funnels/commerce.js";
export { leadgenFunnel as googleLeadgenFunnel } from "./platforms/google/funnels/leadgen.js";

// Platform funnels — TikTok
export { commerceFunnel as tiktokCommerceFunnel } from "./platforms/tiktok/funnels/commerce.js";
export { leadgenFunnel as tiktokLeadgenFunnel } from "./platforms/tiktok/funnels/leadgen.js";

// Verticals — Benchmarks (platform-agnostic)
export { commerceBenchmarks } from "./verticals/commerce/benchmarks.js";
export { leadgenBenchmarks, createLeadgenBenchmarks } from "./verticals/leadgen/benchmarks.js";

// Advisors — Shared
export {
  creativeFatigueAdvisor,
  leadgenCreativeFatigueAdvisor,
  createCreativeFatigueAdvisor,
  auctionCompetitionAdvisor,
  leadgenAuctionCompetitionAdvisor,
  createAuctionCompetitionAdvisor,
  creativeExhaustionAdvisor,
} from "./advisors/shared/index.js";

// Advisors — Platform-specific
export { landingPageAdvisor } from "./advisors/platform/meta/index.js";

// Advisors — Vertical-specific
export { productPageAdvisor, checkoutFrictionAdvisor } from "./advisors/vertical/commerce/index.js";
export {
  leadQualityAdvisor,
  formConversionAdvisor,
  qualifiedCostAdvisor,
} from "./advisors/vertical/leadgen/index.js";

// Advisors — Structural
export {
  adsetFragmentationAdvisor,
  budgetSkewAdvisor,
  learningInstabilityAdvisor,
} from "./advisors/structural/index.js";

// Advisor registry
export { resolveAdvisors } from "./advisors/registry.js";

// Recommendation engine
export { generateRecommendations } from "./advisors/recommendation-engine.js";
export type { ActionProposal, RecommendationResult } from "./advisors/recommendation-engine.js";

// Orchestrator
export type {
  MultiPlatformResult,
  PlatformResult,
  CrossPlatformFinding,
  CrossPlatformSignalType,
  BudgetRecommendation,
  PortfolioAction,
} from "./orchestrator/types.js";
export { runMultiPlatformDiagnostic } from "./orchestrator/runner.js";
export { correlate } from "./orchestrator/correlator.js";
export { generateExecutiveSummary } from "./orchestrator/summary.js";
export { generatePortfolioActions } from "./orchestrator/portfolio-actions.js";

// Config
export type { AccountConfig, PlatformAccountConfig, RawAccountConfig } from "./config/types.js";
export { loadConfig, buildConfig } from "./config/loader.js";

// Skills
export { runFunnelDiagnostic, formatDiagnostic } from "./skills/funnel-diagnostic.js";
export type { FunnelDiagnosticInput } from "./skills/funnel-diagnostic.js";
export { formatMultiPlatformDiagnostic } from "./skills/multi-platform-diagnostic.js";

// Cartridge — Switchboard adapter layer
export { DigitalAdsCartridge } from "./cartridge/index.js";
export {
  bootstrapDigitalAdsCartridge,
  DEFAULT_DIGITAL_ADS_POLICIES,
} from "./cartridge/bootstrap.js";
export type {
  BootstrapDigitalAdsConfig,
  BootstrapDigitalAdsResult,
} from "./cartridge/bootstrap.js";
export { DIGITAL_ADS_MANIFEST } from "./cartridge/manifest.js";
export { DEFAULT_DIGITAL_ADS_GUARDRAILS } from "./cartridge/defaults/guardrails.js";
export { PostMutationVerifier } from "./cartridge/interceptors/verification.js";
export { validateManifest } from "./cartridge/types.js";
export type {
  Cartridge,
  CartridgeManifest,
  CartridgeContext,
  DigitalAdsContext,
  ActionType,
  ReadActionType,
  WriteActionType,
  ActionDefinition,
  ExecuteResult,
  RiskInput,
  GuardrailConfig,
  PolicyConfig,
  ConnectionHealth,
  PlatformHealth,
  HealthCheckResult,
  SessionState,
  ConnectionState,
  CapturedSnapshot,
  UndoRecipe,
  CartridgeInterceptor,
  CampaignInfo,
  AdSetInfo,
  MetaAdsWriteProvider,
  CreateCampaignParams,
  CreateAdSetParams,
  CreateAdParams,
  ConnectParams,
  DiagnoseFunnelParams,
  DiagnosePortfolioParams,
  FetchSnapshotParams,
  AnalyzeStructureParams,
  HealthCheckParams,
  CreateCustomAudienceWriteParams,
  CreateLookalikeAudienceWriteParams,
  CreateAdCreativeWriteParams,
  CreateAdStudyWriteParams,
  CreateAdRuleWriteParams,
} from "./cartridge/types.js";
export type { AdPlatformProvider } from "./cartridge/providers/provider.js";
export { MockProvider, MockPlatformClient } from "./cartridge/providers/mock-provider.js";
export {
  MockMetaAdsWriteProvider,
  createMetaAdsWriteProvider,
} from "./cartridge/providers/meta-write-provider.js";

// Platform API response cache
export { CachedPlatformClient } from "./platforms/cache/cached-client.js";
export { createSnapshotCacheStore } from "./platforms/cache/index.js";
export type { SnapshotCacheStore } from "./platforms/cache/types.js";
export type { RedisLike } from "./platforms/cache/redis-cache.js";

// Reporting
export { ReportBuilder } from "./reporting/report-builder.js";
export { formatPerformanceReport } from "./reporting/formatters/performance-formatter.js";
export { formatCreativeReport } from "./reporting/formatters/creative-formatter.js";
export { formatComparisonReport } from "./reporting/formatters/comparison-formatter.js";
export { REPORT_TEMPLATES, getReportTemplate } from "./reporting/templates/report-templates.js";
export type {
  GenerateReportParams,
  CreativeReportParams,
  AudienceReportParams,
  PlacementReportParams,
  ComparisonReportParams,
  PerformanceReport,
  CreativeReport,
  AudienceReport,
  PlacementReport,
  ComparisonReport,
  ReportRow,
  ReportTimeRange,
  ReportBreakdown,
  ReportLevel,
} from "./reporting/types.js";

// Signal Health
export { PixelDiagnosticsChecker } from "./signal-health/pixel-diagnostics.js";
export { CAPIDiagnosticsChecker } from "./signal-health/capi-diagnostics.js";
export { EMQChecker } from "./signal-health/emq-checker.js";
export { LearningPhaseTracker } from "./signal-health/learning-phase-tracker.js";
export type {
  PixelDiagnostics,
  CAPIDiagnostics,
  EMQResult,
  LearningPhaseInfo,
  DeliveryDiagnostic,
} from "./signal-health/types.js";

// Audiences
export { CustomAudienceBuilder } from "./audiences/custom-audience-builder.js";
export { LookalikeBuilder } from "./audiences/lookalike-builder.js";
export { AudienceInsightsChecker } from "./audiences/audience-insights.js";
export type {
  CreateCustomAudienceParams,
  CreateLookalikeParams,
  CustomAudienceInfo,
  AudienceInsights,
} from "./audiences/types.js";

// Optimization
export { BudgetAllocator } from "./optimization/budget-allocator.js";
export type {
  CampaignPerformanceData,
  CampaignHistoricalData,
} from "./optimization/budget-allocator.js";
export { BidStrategyEngine } from "./optimization/bid-strategy-engine.js";
export { DaypartingEngine } from "./optimization/dayparting-engine.js";
export { OptimizationLoop } from "./optimization/optimization-loop.js";
export type {
  BudgetReallocationPlan,
  BudgetReallocationEntry,
  BidStrategyRecommendation,
  DaypartingRecommendation,
  OptimizationReviewResult,
} from "./optimization/types.js";

// Creative (new modules)
export { CreativeAnalyzer } from "./creative/creative-analyzer.js";
export { CreativeRotationEngine } from "./creative/rotation-engine.js";
export type {
  CreativeAnalysisResult,
  CreativePerformanceEntry,
} from "./creative/creative-analyzer.js";
export type { RotationPlan, AdPerformance } from "./creative/rotation-engine.js";

// Creative — Ad copy generation + asset management
export { AdCopyGenerator } from "./creative/copy-generator.js";
export type {
  BusinessContext,
  CampaignContext,
  AdCopyPackage,
  HeadlineOption,
  PrimaryTextOption,
  MetaCTA,
  AdFormat,
  CopyGeneratorConfig,
} from "./creative/copy-generator.js";
export { CreativeAssetRegistry } from "./creative/asset-handler.js";
export type {
  CreativeAsset,
  AssetSelectionCriteria,
  AssetMatch,
} from "./creative/asset-handler.js";

// A/B Testing (Meta Studies)
export { MetaStudiesClient } from "./ab-testing/meta-studies-client.js";
export type { AdStudy, CreateStudyParams } from "./ab-testing/meta-studies-client.js";

// Rules
export { RulesManager } from "./rules/rules-manager.js";
export { RULE_TEMPLATES, getRuleTemplate, listRuleTemplates } from "./rules/rule-templates.js";
export type { AdRule, CreateRuleParams } from "./rules/types.js";

// Strategy
export { StrategyEngine } from "./strategy/strategy-engine.js";
export { MediaPlanner } from "./strategy/media-planner.js";
export { BestPracticesEngine } from "./strategy/best-practices.js";
export { GuidedSetup } from "./strategy/guided-setup.js";
export type {
  CampaignObjective,
  StrategyRecommendation,
  MediaPlan,
  ReachEstimate,
  GuidedSetupResult,
  Performance5Assessment,
} from "./strategy/types.js";

// New advisors
export { signalQualityAdvisor } from "./advisors/shared/signal-quality.js";
export { learningPhaseHealthAdvisor } from "./advisors/shared/learning-phase-health.js";
export { autoBudgetAdvisor } from "./advisors/optimization/auto-budget.js";
export { autoBidAdvisor } from "./advisors/optimization/auto-bid.js";
export { autoCreativeAdvisor } from "./advisors/optimization/auto-creative.js";

// Compliance & Brand Safety
export { ReviewChecker } from "./compliance/review-checker.js";
export { ComplianceAuditor } from "./compliance/compliance-auditor.js";
export { PublisherBlocklistManager } from "./compliance/publisher-blocklist.js";
export type {
  AdReviewStatus,
  ComplianceAuditResult,
  PublisherBlocklist,
  ContentExclusionConfig,
} from "./compliance/types.js";

// Measurement & Attribution
export { LiftStudyManager } from "./measurement/lift-study-manager.js";
export { AttributionAnalyzer } from "./measurement/attribution-analyzer.js";
export { MMMExporter } from "./measurement/mmm-exporter.js";
export type { LiftStudy, AttributionComparison, MMMExportData } from "./measurement/types.js";

// Pacing & Flight Management
export { FlightManager } from "./pacing/flight-manager.js";
export { PacingMonitor } from "./pacing/pacing-monitor.js";
export type { FlightPlan, PacingStatus, PacingAdjustment } from "./pacing/types.js";

// Anomaly Detection & Alerting
export { AnomalyDetector } from "./alerting/anomaly-detector.js";
export type { DailyMetrics } from "./alerting/anomaly-detector.js";
export { BudgetForecaster } from "./alerting/budget-forecaster.js";
export { PolicyScanner } from "./alerting/policy-scanner.js";
export type { AnomalyResult, BudgetForecast, PolicyScanResult } from "./alerting/types.js";

// Forecasting & Scenarios
export { ScenarioModeler } from "./forecasting/scenario-modeler.js";
export { DiminishingReturnsAnalyzer } from "./forecasting/diminishing-returns.js";
export type { BudgetScenario, DiminishingReturnsResult } from "./forecasting/types.js";

// Catalog Health
export { CatalogHealthChecker } from "./catalog/catalog-health.js";
export { ProductSetManager } from "./catalog/product-sets.js";
export type { CatalogHealth, ProductSet } from "./catalog/types.js";

// Account Memory — Historical learning / optimization records
export { AccountMemory } from "./core/account-memory.js";
export type {
  OptimizationActionType,
  OptimizationRecord,
  OptimizationOutcome,
  AccountInsight,
  AccountMemorySnapshot,
  MemoryRecommendation,
} from "./core/account-memory.js";

// Tracking — Conversion feedback loop (CAPI dispatcher + outcome tracker)
export { CAPIDispatcher } from "./tracking/capi-dispatcher.js";
export type { CAPIDispatcherConfig, CAPIDispatchResult } from "./tracking/capi-dispatcher.js";
export { hashForCAPI, buildUserData } from "./tracking/capi-dispatcher.js";
export { GoogleOfflineDispatcher } from "./tracking/google-offline-dispatcher.js";
export type { GoogleOfflineDispatcherConfig } from "./tracking/google-offline-dispatcher.js";
export { OutcomeTracker } from "./tracking/outcome-tracker.js";
export type { OutcomeMetrics, CampaignOutcome } from "./tracking/outcome-tracker.js";
