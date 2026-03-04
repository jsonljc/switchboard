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
export { accountVariance, getEffectiveVariance } from "./core/analysis/thresholds.js";
export type { AccountHistory } from "./core/analysis/thresholds.js";
export {
  computeStageEconomicImpact,
  computeDropoffEconomicImpact,
  buildElasticityRanking,
} from "./core/analysis/economic-impact.js";
export { buildDiagnosticContext } from "./core/analysis/context-builder.js";
export type { ContextBuilderOptions } from "./core/analysis/context-builder.js";

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
  ConnectParams,
  DiagnoseFunnelParams,
  DiagnosePortfolioParams,
  FetchSnapshotParams,
  AnalyzeStructureParams,
  HealthCheckParams,
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
