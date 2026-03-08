// ---------------------------------------------------------------------------
// DigitalAdsCartridge — implements Cartridge
// ---------------------------------------------------------------------------
// The main cartridge class that routes actions to handlers, manages session
// state, provides risk/guardrail information, and supports both diagnostic
// (read) and mutation (write) actions.
// ---------------------------------------------------------------------------

import type {
  ReadActionType,
  DigitalAdsContext,
  CapturedSnapshot,
  CampaignInfo,
  MetaAdsWriteProvider,
  SessionState,
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
} from "./types.js";
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
} from "@switchboard/schemas";
import type { HealthCheckResult } from "./types.js";
import type { PlatformType, PlatformCredentials } from "../platforms/types.js";
import type { VerticalType } from "../core/types.js";
import type { AdPlatformProvider } from "./providers/provider.js";
import { DIGITAL_ADS_MANIFEST } from "./manifest.js";
import { DEFAULT_DIGITAL_ADS_GUARDRAILS } from "./defaults/guardrails.js";
import { computeRiskInput } from "./risk/categories.js";
import { createSessionState } from "./context/session.js";
import { resolveFunnel, resolveBenchmarks } from "../platforms/registry.js";

// Read action handlers
import { executeConnect } from "./actions/connect.js";
import { executeDiagnoseFunnel } from "./actions/diagnose-funnel.js";
import { executeDiagnosePortfolio } from "./actions/diagnose-portfolio.js";
import { executeFetchSnapshot } from "./actions/fetch-snapshot.js";
import { executeAnalyzeStructure } from "./actions/analyze-structure.js";
import { executeHealthCheck } from "./actions/health-check.js";

// Write action handlers
import {
  executeCampaignPause,
  executeCampaignResume,
  executeCampaignAdjustBudget,
} from "./actions/campaign-mutations.js";
import {
  executeAdSetPause,
  executeAdSetResume,
  executeAdSetAdjustBudget,
  executeTargetingModify,
} from "./actions/adset-mutations.js";
import {
  executeCampaignCreate,
  executeAdSetCreate,
  executeAdCreate,
} from "./actions/creation-mutations.js";

// Module classes for read dispatch wiring
import { ReportBuilder } from "../reporting/report-builder.js";
import { AuctionInsightsChecker } from "../reporting/auction-insights.js";
import { PixelDiagnosticsChecker } from "../signal-health/pixel-diagnostics.js";
import { CAPIDiagnosticsChecker } from "../signal-health/capi-diagnostics.js";
import { EMQChecker } from "../signal-health/emq-checker.js";
import { LearningPhaseTracker } from "../signal-health/learning-phase-tracker.js";
import { CustomAudienceBuilder } from "../audiences/custom-audience-builder.js";
import { AudienceInsightsChecker } from "../audiences/audience-insights.js";
import { BudgetAllocator } from "../optimization/budget-allocator.js";
import type { CampaignPerformanceData } from "../optimization/budget-allocator.js";
import { CreativeAnalyzer } from "../creative/creative-analyzer.js";
import { CreativeVariantGenerator } from "../creative/creative-variant-generator.js";
import { CreativeAssetScorer } from "../creative/asset-scorer.js";
import type {
  AssetPerformanceData,
  VisualAttributes,
  AssetScore,
} from "../creative/asset-scorer.js";
import { MetaStudiesClient } from "../ab-testing/meta-studies-client.js";
import { OptimizationLoop } from "../optimization/optimization-loop.js";
import { RulesManager } from "../rules/rules-manager.js";
import { StrategyEngine } from "../strategy/strategy-engine.js";
import { MediaPlanner } from "../strategy/media-planner.js";
import { DeliveryDiagnosticsChecker } from "../signal-health/delivery-diagnostics.js";
import type { MetaCredentials } from "../platforms/types.js";

// Compliance & measurement modules
import { ReviewChecker } from "../compliance/review-checker.js";
import { ComplianceAuditor } from "../compliance/compliance-auditor.js";
import { PublisherBlocklistManager } from "../compliance/publisher-blocklist.js";
import { LiftStudyManager } from "../measurement/lift-study-manager.js";
import { AttributionAnalyzer } from "../measurement/attribution-analyzer.js";
import { MMMExporter } from "../measurement/mmm-exporter.js";
import { MultiTouchAttributionEngine } from "../measurement/multi-touch-attribution.js";
import type { Touchpoint, ConversionPath, AttributionModel } from "../measurement/multi-touch-attribution.js";

// Pacing & Flight Management
import { FlightManager } from "../pacing/flight-manager.js";
import { PacingMonitor } from "../pacing/pacing-monitor.js";
// Alerting
import { AnomalyDetector } from "../alerting/anomaly-detector.js";
import { BudgetForecaster } from "../alerting/budget-forecaster.js";
import { PolicyScanner } from "../alerting/policy-scanner.js";
// Forecasting
import { ScenarioModeler } from "../forecasting/scenario-modeler.js";
import { DiminishingReturnsAnalyzer } from "../forecasting/diminishing-returns.js";
// Annual Planning
import { AnnualPlanner } from "../forecasting/annual-planner.js";
import type { AnnualPlanParams } from "../forecasting/annual-planner.js";
// Catalog
import { CatalogHealthChecker } from "../catalog/catalog-health.js";
import { ProductSetManager } from "../catalog/product-sets.js";
// Creative Testing Queue
import { CreativeTestingQueue } from "../creative/testing-queue.js";
import type { VariantMetrics } from "../creative/testing-queue.js";
// Notifications
import { NotificationDispatcher } from "../notifications/notification-dispatcher.js";
import type { NotificationChannelConfig } from "../notifications/types.js";
// Cross-Platform Deduplication
import { ConversionDeduplicator } from "../orchestrator/deduplication.js";
import type { PlatformConversionData, OverlapEstimationConfig } from "../orchestrator/deduplication.js";
// Custom KPI
import { CustomKPIEngine } from "../core/custom-kpi.js";
import type { CustomKPIDefinition } from "../core/custom-kpi.js";
// Account Memory
import { AccountMemory } from "../core/account-memory.js";
import type { OptimizationActionType, OptimizationRecord } from "../core/account-memory.js";
// Geo-Holdout Experiments
import { GeoExperimentManager } from "../ab-testing/geo-experiment.js";
import type { GeoRegionMetrics } from "../ab-testing/geo-experiment.js";
// LTV Optimization
import { LTVOptimizer } from "../optimization/ltv-optimizer.js";
import type { CustomerCohort } from "../optimization/ltv-optimizer.js";
// Seasonality
import {
  SeasonalCalendar,
} from "../core/analysis/seasonality.js";
import type {
  EventRegion,
  EventCategory,
} from "../core/analysis/seasonality.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PLATFORMS = new Set<string>(["meta", "google", "tiktok"]);
const VALID_VERTICALS = new Set<string>(["commerce", "leadgen", "brand"]);

const READ_ACTIONS = new Set<string>([
  "digital-ads.platform.connect",
  "digital-ads.funnel.diagnose",
  "digital-ads.portfolio.diagnose",
  "digital-ads.snapshot.fetch",
  "digital-ads.structure.analyze",
  "digital-ads.health.check",
  // Reporting actions
  "digital-ads.report.performance",
  "digital-ads.report.creative",
  "digital-ads.report.audience",
  "digital-ads.report.placement",
  "digital-ads.report.comparison",
  "digital-ads.auction.insights",
  // Signal health actions
  "digital-ads.signal.pixel.diagnose",
  "digital-ads.signal.capi.diagnose",
  "digital-ads.signal.emq.check",
  // Account diagnostics
  "digital-ads.account.learning_phase",
  "digital-ads.account.delivery.diagnose",
  // Audience actions
  "digital-ads.audience.list",
  "digital-ads.audience.insights",
  // Budget actions
  "digital-ads.budget.recommend",
  // Creative actions
  "digital-ads.creative.list",
  "digital-ads.creative.analyze",
  "digital-ads.creative.generate",
  "digital-ads.creative.score_assets",
  "digital-ads.creative.generate_brief",
  // Experiment actions
  "digital-ads.experiment.check",
  "digital-ads.experiment.list",
  // Optimization actions
  "digital-ads.optimization.review",
  // Rule actions
  "digital-ads.rule.list",
  // Strategy actions
  "digital-ads.strategy.recommend",
  "digital-ads.strategy.mediaplan",
  // Reach estimation
  "digital-ads.reach.estimate",
  // Compliance actions
  "digital-ads.compliance.review_status",
  "digital-ads.compliance.audit",
  // Measurement actions
  "digital-ads.measurement.lift_study.check",
  "digital-ads.measurement.attribution.compare",
  "digital-ads.measurement.mmm_export",
  // Multi-Touch Attribution actions
  "digital-ads.attribution.multi_touch",
  "digital-ads.attribution.compare_models",
  "digital-ads.attribution.channel_roles",
  // Pacing actions
  "digital-ads.pacing.check",
  // Alerting actions
  "digital-ads.alert.anomaly_scan",
  "digital-ads.alert.budget_forecast",
  "digital-ads.alert.policy_scan",
  "digital-ads.alert.send_notifications",
  // Forecasting actions
  "digital-ads.forecast.budget_scenario",
  "digital-ads.forecast.diminishing_returns",
  // Annual Planning actions
  "digital-ads.plan.annual",
  "digital-ads.plan.quarterly",
  // Catalog actions
  "digital-ads.catalog.health",
  // Creative Testing Queue actions
  "digital-ads.creative.test_queue",
  "digital-ads.creative.test_evaluate",
  "digital-ads.creative.power_calculate",
  // Custom KPI actions
  "digital-ads.kpi.list",
  "digital-ads.kpi.compute",
  // Cross-Platform Deduplication actions
  "digital-ads.deduplication.analyze",
  "digital-ads.deduplication.estimate_overlap",
  // Geo-Holdout Experiment actions
  "digital-ads.geo_experiment.design",
  "digital-ads.geo_experiment.analyze",
  "digital-ads.geo_experiment.power",
  // Account Memory actions (reads)
  "digital-ads.memory.insights",
  "digital-ads.memory.list",
  "digital-ads.memory.recommend",
  "digital-ads.memory.export",
  // LTV Optimization actions (reads)
  "digital-ads.ltv.project",
  "digital-ads.ltv.optimize",
  "digital-ads.ltv.allocate",
  // Seasonality actions (reads)
  "digital-ads.seasonal.calendar",
  "digital-ads.seasonal.events",
]);

function isPlatformType(v: unknown): v is PlatformType {
  return typeof v === "string" && VALID_PLATFORMS.has(v);
}

function isVerticalType(v: unknown): v is VerticalType {
  return typeof v === "string" && VALID_VERTICALS.has(v);
}

function failResult(summary: string, step: string, error: string): ExecuteResult {
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
// Cartridge
// ---------------------------------------------------------------------------

export class DigitalAdsCartridge implements Cartridge {
  readonly manifest: CartridgeManifest = DIGITAL_ADS_MANIFEST;

  private providers = new Map<PlatformType, AdPlatformProvider>();
  private session: SessionState = createSessionState();
  private snapshots: CapturedSnapshot[] = [];
  private writeProvider: MetaAdsWriteProvider | null = null;
  private readonly flightManager = new FlightManager();
  private readonly creativeTestingQueue = new CreativeTestingQueue();
  private readonly kpiEngine = new CustomKPIEngine();
  private readonly geoExperimentManager = new GeoExperimentManager();
  private readonly accountMemory = new AccountMemory();
  private readonly seasonalCalendar = new SeasonalCalendar();
  private notificationChannels: NotificationChannelConfig[] = [];

  /** Register a diagnostic provider for a platform */
  registerProvider(provider: AdPlatformProvider): void {
    this.providers.set(provider.platform, provider);
  }

  /** Register the write provider for campaign/ad set mutations */
  registerWriteProvider(provider: MetaAdsWriteProvider): void {
    this.writeProvider = provider;
  }

  /** @internal — expose write provider for interceptors */
  getWriteProvider(): MetaAdsWriteProvider | null {
    return this.writeProvider;
  }

  /**
   * Get Meta Graph API config from session credentials.
   * Used to instantiate module classes on-demand for read dispatch.
   */
  private getMetaApiConfig(): { baseUrl: string; accessToken: string } | null {
    const metaConn = this.session.connections.get("meta");
    if (metaConn?.credentials?.platform === "meta") {
      return {
        baseUrl: "https://graph.facebook.com/v21.0",
        accessToken: (metaConn.credentials as MetaCredentials).accessToken,
      };
    }
    return null;
  }

  private noApiConfigResult(): ExecuteResult {
    return failResult(
      "No Meta API credentials available — connect to Meta first",
      "resolve_credentials",
      "No Meta connection established. Run digital-ads.platform.connect first.",
    );
  }

  async initialize(context: CartridgeContext): Promise<void> {
    this.session = createSessionState();
    this.snapshots = [];

    // Auto-connect any pre-configured credentials
    if (context.connectionCredentials) {
      for (const [platformStr, creds] of Object.entries(context.connectionCredentials)) {
        if (!isPlatformType(platformStr)) continue;
        const provider = this.providers.get(platformStr);
        if (provider && creds) {
          this.session.connections.set(platformStr, {
            platform: platformStr,
            credentials: creds as PlatformCredentials,
            status: "connected",
            connectedAt: Date.now(),
          });
        }
      }
    }
  }

  async enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    const enriched: Record<string, unknown> = {};

    switch (actionType) {
      case "digital-ads.funnel.diagnose": {
        const platform = parameters.platform;
        const vertical = parameters.vertical;
        if (isPlatformType(platform) && isVerticalType(vertical)) {
          try {
            enriched.resolvedFunnel = resolveFunnel(platform, vertical);
            enriched.resolvedBenchmarks = resolveBenchmarks(platform, vertical);
          } catch {
            // Will fail during execution with a better error
          }
        }
        break;
      }

      case "digital-ads.portfolio.diagnose": {
        const platforms = parameters.platforms;
        if (Array.isArray(platforms)) {
          const resolved: Array<{ platform: string; funnel: unknown; benchmarks: unknown }> = [];
          for (const p of platforms) {
            if (isPlatformType(p?.platform) && isVerticalType(parameters.vertical)) {
              try {
                resolved.push({
                  platform: p.platform,
                  funnel: resolveFunnel(p.platform, parameters.vertical as VerticalType),
                  benchmarks: resolveBenchmarks(p.platform, parameters.vertical as VerticalType),
                });
              } catch {
                // Individual platform resolution failure
              }
            }
          }
          enriched.resolvedPlatforms = resolved;
        }
        break;
      }

      case "digital-ads.snapshot.fetch": {
        const timeRange = parameters.timeRange as { since?: string; until?: string } | undefined;
        if (timeRange) {
          if (!timeRange.since || !timeRange.until) {
            enriched.validationError = "timeRange requires both 'since' and 'until' dates";
          } else {
            const since = new Date(timeRange.since);
            const until = new Date(timeRange.until);
            if (since > until) {
              enriched.validationError = "timeRange.since must be before timeRange.until";
            }
            enriched.periodDays =
              Math.ceil((until.getTime() - since.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          }
        }
        break;
      }

      case "digital-ads.platform.connect": {
        const creds = parameters.credentials as PlatformCredentials | undefined;
        if (creds && isPlatformType(parameters.platform)) {
          if (creds.platform !== parameters.platform) {
            enriched.validationError = `Credential platform "${creds.platform}" doesn't match requested platform "${parameters.platform}"`;
          }
        }
        break;
      }

      // Write actions: enrich with current entity state for risk scoring
      case "digital-ads.campaign.pause":
      case "digital-ads.campaign.resume":
      case "digital-ads.campaign.adjust_budget": {
        if (this.writeProvider && parameters.campaignId) {
          try {
            const campaign = await this.writeProvider.getCampaign(parameters.campaignId as string);
            enriched.currentBudget = campaign.dailyBudget / 100;
            enriched.campaignName = campaign.name;
            enriched.campaignStatus = campaign.status;
            enriched.deliveryStatus = campaign.deliveryStatus;
            enriched.objective = campaign.objective;
            enriched.endTime = campaign.endTime;
          } catch {
            // Continue without enrichment
          }
        }
        break;
      }

      case "digital-ads.adset.pause":
      case "digital-ads.adset.resume":
      case "digital-ads.adset.adjust_budget":
      case "digital-ads.targeting.modify": {
        if (this.writeProvider && parameters.adSetId) {
          try {
            const adSet = await this.writeProvider.getAdSet(parameters.adSetId as string);
            enriched.currentBudget = adSet.dailyBudget / 100;
            enriched.adSetName = adSet.name;
            enriched.adSetStatus = adSet.status;
            enriched.deliveryStatus = adSet.deliveryStatus;
            enriched.endTime = adSet.endTime;
          } catch {
            // Continue without enrichment
          }
        }
        break;
      }

      case "digital-ads.structure.analyze":
      case "digital-ads.health.check":
        break;

      // Reporting actions — validate adAccountId
      case "digital-ads.report.performance":
      case "digital-ads.report.creative":
      case "digital-ads.report.audience":
      case "digital-ads.report.placement":
      case "digital-ads.report.comparison":
      case "digital-ads.auction.insights": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Signal health actions — validate connection
      case "digital-ads.signal.pixel.diagnose":
      case "digital-ads.signal.capi.diagnose":
      case "digital-ads.signal.emq.check":
      case "digital-ads.account.learning_phase":
      case "digital-ads.account.delivery.diagnose": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Audience read actions — validate connection
      case "digital-ads.audience.list":
      case "digital-ads.audience.insights":
      case "digital-ads.reach.estimate": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Creative read actions — validate connection
      case "digital-ads.creative.list":
      case "digital-ads.creative.analyze": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Experiment read actions — validate connection
      case "digital-ads.experiment.check":
      case "digital-ads.experiment.list": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Rule read actions — validate connection
      case "digital-ads.rule.list": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Strategy actions — no API needed, but validate params
      case "digital-ads.strategy.recommend":
      case "digital-ads.strategy.mediaplan":
      case "digital-ads.budget.recommend":
      case "digital-ads.optimization.review":
      case "digital-ads.creative.generate":
      case "digital-ads.creative.score_assets":
      case "digital-ads.creative.generate_brief":
        break;

      // Compliance actions — validate connection
      case "digital-ads.compliance.review_status":
      case "digital-ads.compliance.audit": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Measurement actions — validate connection
      case "digital-ads.measurement.lift_study.check":
      case "digital-ads.measurement.attribution.compare":
      case "digital-ads.measurement.mmm_export": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Alerting actions — validate connection for API-dependent ones
      case "digital-ads.alert.budget_forecast":
      case "digital-ads.alert.policy_scan": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Alerting/forecasting — no API needed, local computation
      case "digital-ads.alert.anomaly_scan":
      case "digital-ads.alert.send_notifications":
      case "digital-ads.alert.configure_notifications":
      case "digital-ads.forecast.budget_scenario":
      case "digital-ads.forecast.diminishing_returns":
      // falls through — Annual planning also needs no API
      case "digital-ads.plan.annual":
      case "digital-ads.plan.quarterly":
        break;

      // Pacing read — no API needed for flight lookup
      case "digital-ads.pacing.check":
      case "digital-ads.pacing.create_flight":
      case "digital-ads.pacing.auto_adjust":
        break;

      // Catalog actions — validate connection
      case "digital-ads.catalog.health":
      case "digital-ads.catalog.product_sets": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError = "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Creative testing queue — no API needed, local computation
      case "digital-ads.creative.test_queue":
      case "digital-ads.creative.test_evaluate":
      case "digital-ads.creative.test_create":
      case "digital-ads.creative.test_conclude":
      case "digital-ads.creative.power_calculate":
        break;

      // Multi-Touch Attribution — no API needed, local computation
      case "digital-ads.attribution.multi_touch":
      case "digital-ads.attribution.compare_models":
      case "digital-ads.attribution.channel_roles":
        break;

      // Custom KPI — no API needed, local computation
      case "digital-ads.kpi.list":
      case "digital-ads.kpi.compute":
      case "digital-ads.kpi.register":
      case "digital-ads.kpi.remove":
        break;

      // Deduplication — no API needed, takes pre-fetched data
      case "digital-ads.deduplication.analyze":
      case "digital-ads.deduplication.estimate_overlap":
        break;

      // Geo-holdout experiments — no API needed, local computation
      case "digital-ads.geo_experiment.design":
      case "digital-ads.geo_experiment.analyze":
      case "digital-ads.geo_experiment.power":
      case "digital-ads.geo_experiment.create":
      case "digital-ads.geo_experiment.conclude":
        break;

      // Account Memory actions — no API needed, local computation
      case "digital-ads.memory.insights":
      case "digital-ads.memory.list":
      case "digital-ads.memory.recommend":
      case "digital-ads.memory.record":
      case "digital-ads.memory.record_outcome":
      case "digital-ads.memory.export":
      case "digital-ads.memory.import":
        break;

      // LTV Optimization — no API needed, takes CRM cohort data
      case "digital-ads.ltv.project":
      case "digital-ads.ltv.optimize":
      case "digital-ads.ltv.allocate":
        break;

      // Seasonality — no API needed, local calendar computation
      case "digital-ads.seasonal.calendar":
      case "digital-ads.seasonal.events":
      case "digital-ads.seasonal.add_event":
        break;
    }

    return enriched;
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult> {
    // Check for validation errors (set by enrichContext)
    const ctx = context as DigitalAdsContext;
    if (typeof ctx.validationError === "string") {
      return failResult(
        `Validation failed: ${ctx.validationError}`,
        "validation",
        ctx.validationError,
      );
    }

    // Dispatch to read or write handler
    if (READ_ACTIONS.has(actionType)) {
      return this.dispatchReadAction(actionType as ReadActionType, parameters, context);
    }
    return this.dispatchWriteAction(actionType, parameters);
  }

  private async dispatchReadAction(
    actionType: ReadActionType,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult> {
    switch (actionType) {
      case "digital-ads.platform.connect": {
        const params = parameters as unknown as ConnectParams;
        const provider = this.resolveProvider(params.platform);
        if (!provider) return this.noProviderResult(params.platform);
        return executeConnect(params, provider, this.session);
      }

      case "digital-ads.funnel.diagnose": {
        const params = parameters as unknown as DiagnoseFunnelParams;
        const provider = this.resolveProvider(params.platform);
        if (!provider) return this.noProviderResult(params.platform);
        const creds = this.resolveCredentials(params.platform, context);
        return executeDiagnoseFunnel(params, provider, this.session, creds);
      }

      case "digital-ads.portfolio.diagnose": {
        const params = parameters as unknown as DiagnosePortfolioParams;
        return executeDiagnosePortfolio(params, this.providers, this.session);
      }

      case "digital-ads.snapshot.fetch": {
        const params = parameters as unknown as FetchSnapshotParams;
        const provider = this.resolveProvider(params.platform);
        if (!provider) return this.noProviderResult(params.platform);
        const creds = this.resolveCredentials(params.platform, context);
        return executeFetchSnapshot(params, provider, this.session, creds);
      }

      case "digital-ads.structure.analyze": {
        const params = parameters as unknown as AnalyzeStructureParams;
        const provider = this.resolveProvider(params.platform);
        if (!provider) return this.noProviderResult(params.platform);
        const creds = this.resolveCredentials(params.platform, context);
        return executeAnalyzeStructure(params, provider, this.session, creds);
      }

      case "digital-ads.health.check": {
        const params = parameters as unknown as HealthCheckParams;
        return executeHealthCheck(params, this.providers);
      }

      // --- Reporting actions (wired to ReportBuilder) ---
      case "digital-ads.report.performance": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const builder = new ReportBuilder(apiConfig.baseUrl, apiConfig.accessToken);
          const report = await builder.generatePerformanceReport(parameters as unknown as Parameters<typeof builder.generatePerformanceReport>[0]);
          return {
            success: true,
            summary: `Performance report generated: ${report.rows.length} rows, $${report.summary.totalSpend.toFixed(2)} total spend`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: report,
          };
        } catch (err) {
          return failResult(
            `Failed to generate performance report: ${err instanceof Error ? err.message : String(err)}`,
            "report.performance",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.report.creative": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const builder = new ReportBuilder(apiConfig.baseUrl, apiConfig.accessToken);
          const report = await builder.generateCreativeReport(parameters as unknown as Parameters<typeof builder.generateCreativeReport>[0]);
          return {
            success: true,
            summary: `Creative report generated: ${report.creatives.length} creatives analyzed`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: report,
          };
        } catch (err) {
          return failResult(
            `Failed to generate creative report: ${err instanceof Error ? err.message : String(err)}`,
            "report.creative",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.report.audience": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const builder = new ReportBuilder(apiConfig.baseUrl, apiConfig.accessToken);
          const report = await builder.generateAudienceReport(parameters as unknown as Parameters<typeof builder.generateAudienceReport>[0]);
          return {
            success: true,
            summary: `Audience report generated: ${report.ageGender.length} age/gender segments, ${report.countries.length} countries`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: report,
          };
        } catch (err) {
          return failResult(
            `Failed to generate audience report: ${err instanceof Error ? err.message : String(err)}`,
            "report.audience",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.report.placement": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const builder = new ReportBuilder(apiConfig.baseUrl, apiConfig.accessToken);
          const report = await builder.generatePlacementReport(parameters as unknown as Parameters<typeof builder.generatePlacementReport>[0]);
          return {
            success: true,
            summary: `Placement report generated: ${report.placements.length} placements analyzed`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: report,
          };
        } catch (err) {
          return failResult(
            `Failed to generate placement report: ${err instanceof Error ? err.message : String(err)}`,
            "report.placement",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.report.comparison": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const builder = new ReportBuilder(apiConfig.baseUrl, apiConfig.accessToken);
          const report = await builder.generateComparisonReport(parameters as unknown as Parameters<typeof builder.generateComparisonReport>[0]);
          return {
            success: true,
            summary: `Comparison report generated: ${report.changes.length} metrics compared`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: report,
          };
        } catch (err) {
          return failResult(
            `Failed to generate comparison report: ${err instanceof Error ? err.message : String(err)}`,
            "report.comparison",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Auction insights (wired to AuctionInsightsChecker) ---
      case "digital-ads.auction.insights": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new AuctionInsightsChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const entityId = parameters.entityId as string;
          if (!entityId) return failResult("Missing entityId", "validation", "entityId is required");
          const result = await checker.analyze({
            entityId,
            entityLevel: parameters.entityLevel as "campaign" | "adset" | "account" | undefined,
            datePreset: parameters.datePreset as string | undefined,
            since: parameters.since as string | undefined,
            until: parameters.until as string | undefined,
          });
          return {
            success: true,
            summary: `Auction insights: ${result.competitors.length} competitor(s), ${result.yourPosition.impressionShare.toFixed(1)}% impression share, competitive pressure: ${result.yourPosition.competitivePressure}`,
            externalRefs: { entityId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to fetch auction insights: ${err instanceof Error ? err.message : String(err)}`,
            "auction.insights",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Signal health actions (wired to diagnostics checkers) ---
      case "digital-ads.signal.pixel.diagnose": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new PixelDiagnosticsChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const diagnostics = await checker.diagnose(adAccountId);
          const totalIssues = diagnostics.reduce((sum, d) => sum + d.issues.length, 0);
          return {
            success: true,
            summary: `Pixel diagnostics: ${diagnostics.length} pixel(s) checked, ${totalIssues} issue(s) found`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: diagnostics,
          };
        } catch (err) {
          return failResult(
            `Failed to diagnose pixels: ${err instanceof Error ? err.message : String(err)}`,
            "signal.pixel.diagnose",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.signal.capi.diagnose": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new CAPIDiagnosticsChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const pixelId = parameters.pixelId as string;
          if (!pixelId) return failResult("Missing pixelId", "validation", "pixelId is required");
          const diagnostics = await checker.diagnose(pixelId);
          return {
            success: true,
            summary: `CAPI diagnostics: server=${diagnostics.serverEventsEnabled ? "enabled" : "disabled"}, ${diagnostics.issues.length} issue(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: diagnostics,
          };
        } catch (err) {
          return failResult(
            `Failed to diagnose CAPI: ${err instanceof Error ? err.message : String(err)}`,
            "signal.capi.diagnose",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.signal.emq.check": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new EMQChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const datasetId = parameters.datasetId as string;
          if (!datasetId) return failResult("Missing datasetId", "validation", "datasetId is required");
          const result = await checker.check(datasetId);
          return {
            success: true,
            summary: `EMQ check: overall score ${result.overallScore}/10, ${result.recommendations.length} recommendation(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to check EMQ: ${err instanceof Error ? err.message : String(err)}`,
            "signal.emq.check",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Account diagnostics ---
      case "digital-ads.account.learning_phase": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const tracker = new LearningPhaseTracker(apiConfig.baseUrl, apiConfig.accessToken);
          const adSetId = parameters.adSetId as string | undefined;
          const adAccountId = parameters.adAccountId as string | undefined;
          if (adSetId) {
            const info = await tracker.checkAdSet(adSetId);
            return {
              success: true,
              summary: `Learning phase: ${info.learningStage} (${info.eventsCurrent}/${info.eventsNeeded} events)`,
              externalRefs: {},
              rollbackAvailable: false,
              partialFailures: [],
              durationMs: Date.now() - start,
              undoRecipe: null,
              data: info,
            };
          } else if (adAccountId) {
            const results = await tracker.checkAllAdSets(adAccountId);
            const stuck = results.filter((r) => r.stuckReason !== null);
            return {
              success: true,
              summary: `Learning phase check: ${results.length} ad set(s), ${stuck.length} stuck/limited`,
              externalRefs: {},
              rollbackAvailable: false,
              partialFailures: [],
              durationMs: Date.now() - start,
              undoRecipe: null,
              data: results,
            };
          }
          return failResult("Missing adSetId or adAccountId", "validation", "Provide adSetId or adAccountId");
        } catch (err) {
          return failResult(
            `Failed to check learning phase: ${err instanceof Error ? err.message : String(err)}`,
            "account.learning_phase",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.account.delivery.diagnose": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new DeliveryDiagnosticsChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const campaignId = parameters.campaignId as string;
          if (!campaignId) return failResult("Missing campaignId", "validation", "campaignId is required");
          const diagnostic = await checker.diagnose(campaignId);
          return {
            success: true,
            summary: `Delivery diagnostics for "${diagnostic.campaignName}": ${diagnostic.issues.length} issue(s), ${diagnostic.activeAdSetCount}/${diagnostic.totalAdSetCount} active ad sets`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: diagnostic,
          };
        } catch (err) {
          return failResult(
            `Failed to diagnose delivery: ${err instanceof Error ? err.message : String(err)}`,
            "account.delivery.diagnose",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Audience actions (wired to CustomAudienceBuilder / AudienceInsightsChecker) ---
      case "digital-ads.audience.list": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const builder = new CustomAudienceBuilder(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const audiences = await builder.list(adAccountId, parameters.limit as number | undefined);
          return {
            success: true,
            summary: `Listed ${audiences.length} custom audience(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: audiences,
          };
        } catch (err) {
          return failResult(
            `Failed to list audiences: ${err instanceof Error ? err.message : String(err)}`,
            "audience.list",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.audience.insights": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new AudienceInsightsChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const audienceId = parameters.audienceId as string | undefined;
          const adAccountId = parameters.adAccountId as string | undefined;
          const targetingSpec = parameters.targetingSpec as Record<string, unknown> | undefined;
          if (audienceId) {
            const insights = await checker.getInsights(audienceId);
            return {
              success: true,
              summary: `Audience insights: ~${insights.approximateCount.toLocaleString()} users`,
              externalRefs: {},
              rollbackAvailable: false,
              partialFailures: [],
              durationMs: Date.now() - start,
              undoRecipe: null,
              data: insights,
            };
          } else if (adAccountId && targetingSpec) {
            const estimate = await checker.getReachEstimate(adAccountId, targetingSpec);
            return {
              success: true,
              summary: `Reach estimate: ${estimate.dailyReach.lower.toLocaleString()}–${estimate.dailyReach.upper.toLocaleString()} daily reach`,
              externalRefs: {},
              rollbackAvailable: false,
              partialFailures: [],
              durationMs: Date.now() - start,
              undoRecipe: null,
              data: estimate,
            };
          }
          return failResult("Missing audienceId or adAccountId+targetingSpec", "validation", "Provide audienceId or adAccountId with targetingSpec");
        } catch (err) {
          return failResult(
            `Failed to get audience insights: ${err instanceof Error ? err.message : String(err)}`,
            "audience.insights",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Budget actions (wired to BudgetAllocator) ---
      case "digital-ads.budget.recommend": {
        const start = Date.now();
        try {
          const allocator = new BudgetAllocator();
          const campaigns = (parameters.campaigns ?? []) as CampaignPerformanceData[];
          if (campaigns.length === 0) {
            return failResult(
              "No campaign data provided for budget recommendation",
              "validation",
              "Provide campaigns array with performance data",
            );
          }
          const plan = allocator.recommend(campaigns, {
            maxShiftPercent: parameters.maxShiftPercent as number | undefined,
          });
          return {
            success: true,
            summary: `Budget recommendation: ${plan.summary}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: plan,
          };
        } catch (err) {
          return failResult(
            `Failed to generate budget recommendation: ${err instanceof Error ? err.message : String(err)}`,
            "budget.recommend",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Creative actions ---
      case "digital-ads.creative.list": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
          const limit = (parameters.limit as number) ?? 50;
          const url =
            `${apiConfig.baseUrl}/${accountId}/adcreatives?fields=` +
            "id,name,status,object_type,thumbnail_url,effective_object_story_id" +
            `&limit=${limit}&access_token=${apiConfig.accessToken}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Meta API error: HTTP ${response.status}`);
          }
          const data = (await response.json()) as Record<string, unknown>;
          const creatives = (data.data ?? []) as Record<string, unknown>[];
          return {
            success: true,
            summary: `Listed ${creatives.length} creative(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: creatives,
          };
        } catch (err) {
          return failResult(
            `Failed to list creatives: ${err instanceof Error ? err.message : String(err)}`,
            "creative.list",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.creative.analyze": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const analyzer = new CreativeAnalyzer(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const result = await analyzer.analyze(adAccountId, parameters.datePreset as string | undefined);
          return {
            success: true,
            summary: `Creative analysis: ${result.topPerformers.length} top, ${result.fatigued.length} fatigued, ${result.recommendations.length} recommendation(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to analyze creatives: ${err instanceof Error ? err.message : String(err)}`,
            "creative.analyze",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.creative.generate": {
        const start = Date.now();
        try {
          const generator = new CreativeVariantGenerator();
          const productDescription = parameters.productDescription as string;
          const targetAudience = parameters.targetAudience as string;
          if (!productDescription || !targetAudience) {
            return failResult(
              "Missing productDescription or targetAudience",
              "validation",
              "productDescription and targetAudience are required",
            );
          }
          const result = generator.generateVariants({
            productDescription,
            targetAudience,
            angles: parameters.angles as string[] | undefined,
            variantsPerAngle: parameters.variantsPerAngle as number | undefined,
          });
          return {
            success: true,
            summary: `Generated ${result.totalGenerated} creative variant(s) across ${result.angles.length} angle(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to generate creative variants: ${err instanceof Error ? err.message : String(err)}`,
            "creative.generate",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Creative Asset Scoring ---
      case "digital-ads.creative.score_assets": {
        const start = Date.now();
        try {
          const scorer = new CreativeAssetScorer();
          const accountId = parameters.accountId as string;
          const assets = parameters.assets as AssetPerformanceData[];
          if (!accountId || !assets || !Array.isArray(assets)) {
            return failResult(
              "Missing accountId or assets",
              "validation",
              "accountId and assets array are required",
            );
          }
          // Reconstruct visual attributes map if provided
          let visualAttributesMap: Map<string, VisualAttributes> | undefined;
          const rawVisualMap = parameters.visualAttributes as
            | Record<string, VisualAttributes>
            | undefined;
          if (rawVisualMap && typeof rawVisualMap === "object") {
            visualAttributesMap = new Map(Object.entries(rawVisualMap));
          }
          const result = scorer.analyzePortfolio(accountId, assets, visualAttributesMap);
          return {
            success: true,
            summary: `Scored ${result.totalAssetsAnalyzed} creative asset(s) — avg score: ${result.insights.avgOverallScore}, diversity: ${result.insights.diversityScore}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to score creative assets: ${err instanceof Error ? err.message : String(err)}`,
            "creative.score_assets",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      case "digital-ads.creative.generate_brief": {
        const start = Date.now();
        try {
          const scorer = new CreativeAssetScorer();
          const topPerformers = parameters.topPerformers as AssetScore[];
          const weaknesses = parameters.weaknesses as string[];
          if (!topPerformers || !Array.isArray(topPerformers)) {
            return failResult(
              "Missing topPerformers",
              "validation",
              "topPerformers array is required",
            );
          }
          const brief = scorer.generateCreativeBrief(
            topPerformers,
            weaknesses ?? [],
          );
          return {
            success: true,
            summary: `Creative brief generated: ${brief.recommendedFormats.length} format(s), ${brief.visualGuidelines.length} visual guideline(s), ${brief.avoidList.length} avoid item(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: brief,
          };
        } catch (err) {
          return failResult(
            `Failed to generate creative brief: ${err instanceof Error ? err.message : String(err)}`,
            "creative.generate_brief",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Experiment actions (wired to MetaStudiesClient) ---
      case "digital-ads.experiment.check": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const client = new MetaStudiesClient(apiConfig.baseUrl, apiConfig.accessToken);
          const studyId = parameters.studyId as string;
          if (!studyId) return failResult("Missing studyId", "validation", "studyId is required");
          const study = await client.get(studyId);
          return {
            success: true,
            summary: `Experiment "${study.name}": status=${study.status}, ${study.cells.length} cell(s)`,
            externalRefs: { studyId: study.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: study,
          };
        } catch (err) {
          return failResult(
            `Failed to check experiment: ${err instanceof Error ? err.message : String(err)}`,
            "experiment.check",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.experiment.list": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const client = new MetaStudiesClient(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const studies = await client.list(adAccountId);
          return {
            success: true,
            summary: `Listed ${studies.length} experiment(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: studies,
          };
        } catch (err) {
          return failResult(
            `Failed to list experiments: ${err instanceof Error ? err.message : String(err)}`,
            "experiment.list",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Optimization actions (wired to OptimizationLoop) ---
      case "digital-ads.optimization.review": {
        const start = Date.now();
        try {
          const loop = new OptimizationLoop();
          const accountId = (parameters.adAccountId ?? parameters.accountId) as string;
          if (!accountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const campaigns = (parameters.campaigns ?? []) as Array<{
            campaignId: string;
            campaignName: string;
            dailyBudget: number;
            spend: number;
            conversions: number;
            cpa: number | null;
            roas: number | null;
            deliveryStatus: string;
          }>;
          const adSets = (parameters.adSets ?? []) as Array<{
            adSetId: string;
            campaignId: string;
            dailyBudget: number;
            spend: number;
            conversions: number;
            cpa: number | null;
            bidStrategy: string;
            bidAmount: number | null;
            learningPhase: boolean;
          }>;
          const result = await loop.review({
            accountId,
            campaigns,
            adSets,
          });
          return {
            success: true,
            summary: `Optimization review: score ${result.overallScore}/100, ${result.tier1Actions.length} auto actions, ${result.tier2Actions.length} recommended`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to run optimization review: ${err instanceof Error ? err.message : String(err)}`,
            "optimization.review",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Rule actions (wired to RulesManager) ---
      case "digital-ads.rule.list": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const manager = new RulesManager(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const rules = await manager.list(adAccountId);
          return {
            success: true,
            summary: `Listed ${rules.length} automated rule(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: rules,
          };
        } catch (err) {
          return failResult(
            `Failed to list rules: ${err instanceof Error ? err.message : String(err)}`,
            "rule.list",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Strategy actions (wired to StrategyEngine / MediaPlanner) ---
      case "digital-ads.strategy.recommend": {
        const start = Date.now();
        try {
          const engine = new StrategyEngine();
          const businessGoal = parameters.businessGoal as string;
          const monthlyBudget = parameters.monthlyBudget as number;
          if (!businessGoal || !monthlyBudget) {
            return failResult(
              "Missing businessGoal or monthlyBudget",
              "validation",
              "businessGoal and monthlyBudget are required",
            );
          }
          const recommendation = engine.recommend({
            businessGoal,
            monthlyBudget,
            targetAudience: (parameters.targetAudience as string) ?? "broad",
            vertical: (parameters.vertical as string) ?? "commerce",
            hasExistingCampaigns: (parameters.hasExistingCampaigns as boolean) ?? false,
          });
          return {
            success: true,
            summary: `Strategy recommendation: ${recommendation.objective}, ${recommendation.structure.campaignCount} campaign(s), ${recommendation.bidStrategy.split(" — ")[0]}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: recommendation,
          };
        } catch (err) {
          return failResult(
            `Failed to generate strategy recommendation: ${err instanceof Error ? err.message : String(err)}`,
            "strategy.recommend",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.strategy.mediaplan": {
        const start = Date.now();
        try {
          const planner = new MediaPlanner();
          const totalBudget = parameters.totalBudget as number;
          const durationDays = parameters.durationDays as number;
          const objective = parameters.objective as string;
          if (!totalBudget || !durationDays || !objective) {
            return failResult(
              "Missing totalBudget, durationDays, or objective",
              "validation",
              "totalBudget, durationDays, and objective are required",
            );
          }
          const plan = planner.plan({
            totalBudget,
            durationDays,
            objective: objective as Parameters<typeof planner.plan>[0]["objective"],
            targetAudience: (parameters.targetAudience as string) ?? "broad",
          });
          return {
            success: true,
            summary: `Media plan: $${plan.totalBudget} over ${plan.duration} days, ${plan.phases.length} phase(s), ~${plan.estimatedResults.estimatedConversions} conversions`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: plan,
          };
        } catch (err) {
          return failResult(
            `Failed to generate media plan: ${err instanceof Error ? err.message : String(err)}`,
            "strategy.mediaplan",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Reach estimation (wired to AudienceInsightsChecker) ---
      case "digital-ads.reach.estimate": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new AudienceInsightsChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          const targetingSpec = parameters.targetingSpec as Record<string, unknown>;
          if (!adAccountId || !targetingSpec) {
            return failResult(
              "Missing adAccountId or targetingSpec",
              "validation",
              "adAccountId and targetingSpec are required",
            );
          }
          const estimate = await checker.getReachEstimate(adAccountId, targetingSpec);
          return {
            success: true,
            summary: `Reach estimate: ${estimate.dailyReach.lower.toLocaleString()}–${estimate.dailyReach.upper.toLocaleString()} daily reach`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: estimate,
          };
        } catch (err) {
          return failResult(
            `Failed to estimate reach: ${err instanceof Error ? err.message : String(err)}`,
            "reach.estimate",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Compliance actions (Phase 9) ---
      case "digital-ads.compliance.review_status": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new ReviewChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const statuses = await checker.checkReviewStatus(adAccountId);
          const disapproved = statuses.filter((s) => s.effectiveStatus === "DISAPPROVED");
          return {
            success: true,
            summary: `Ad review status: ${statuses.length} ad(s) flagged, ${disapproved.length} disapproved`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: statuses,
          };
        } catch (err) {
          return failResult(
            `Failed to check review status: ${err instanceof Error ? err.message : String(err)}`,
            "compliance.review_status",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.compliance.audit": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const auditor = new ComplianceAuditor(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const result = await auditor.audit(adAccountId);
          return {
            success: true,
            summary: `Compliance audit: score ${result.overallScore}/100, ${result.issues.length} issue(s), ${result.recommendations.length} recommendation(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to run compliance audit: ${err instanceof Error ? err.message : String(err)}`,
            "compliance.audit",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Measurement actions (Phase 9) ---
      case "digital-ads.measurement.lift_study.check": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const manager = new LiftStudyManager(apiConfig.baseUrl, apiConfig.accessToken);
          const studyId = parameters.studyId as string;
          if (!studyId) return failResult("Missing studyId", "validation", "studyId is required");
          const study = await manager.check(studyId);
          const resultSummary = study.results
            ? `, lift ${study.results.liftPercent?.toFixed(1) ?? "N/A"}%`
            : "";
          return {
            success: true,
            summary: `Lift study "${study.name}": status=${study.status}${resultSummary}`,
            externalRefs: { studyId: study.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: study,
          };
        } catch (err) {
          return failResult(
            `Failed to check lift study: ${err instanceof Error ? err.message : String(err)}`,
            "measurement.lift_study.check",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.measurement.attribution.compare": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const analyzer = new AttributionAnalyzer(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const comparisons = await analyzer.compare(adAccountId, parameters.datePreset as string | undefined);
          return {
            success: true,
            summary: `Attribution comparison: ${comparisons.length} metric(s) across attribution windows`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: comparisons,
          };
        } catch (err) {
          return failResult(
            `Failed to compare attribution: ${err instanceof Error ? err.message : String(err)}`,
            "measurement.attribution.compare",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.measurement.mmm_export": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const exporter = new MMMExporter(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          const timeRange = parameters.timeRange as { since: string; until: string } | undefined;
          if (!adAccountId || !timeRange) {
            return failResult("Missing adAccountId or timeRange", "validation", "adAccountId and timeRange are required");
          }
          const format = (parameters.format as "csv" | "json") ?? "json";
          const data = await exporter.export(adAccountId, timeRange, format);
          return {
            success: true,
            summary: `MMM export: ${data.dailyData.length} day(s) of data from ${timeRange.since} to ${timeRange.until}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data,
          };
        } catch (err) {
          return failResult(
            `Failed to export MMM data: ${err instanceof Error ? err.message : String(err)}`,
            "measurement.mmm_export",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Multi-Touch Attribution actions ---
      case "digital-ads.attribution.multi_touch": {
        const start = Date.now();
        try {
          const engine = new MultiTouchAttributionEngine();
          const touchpoints = parameters.touchpoints as Touchpoint[];
          const paths = parameters.paths as ConversionPath[];
          const model = parameters.model as AttributionModel;
          if (!touchpoints || !paths || !model) {
            return failResult(
              "Missing required parameters",
              "validation",
              "touchpoints, paths, and model are required",
            );
          }
          const options = parameters.decayHalfLife
            ? { decayHalfLife: Number(parameters.decayHalfLife) }
            : undefined;
          const result = engine.attribute(touchpoints, paths, model, options);
          return {
            success: true,
            summary: `Multi-touch attribution (${model}): ${result.channelAttribution.length} channel(s) attributed, avg path length ${result.insights.avgPathLength}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to run multi-touch attribution: ${err instanceof Error ? err.message : String(err)}`,
            "attribution.multi_touch",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.attribution.compare_models": {
        const start = Date.now();
        try {
          const engine = new MultiTouchAttributionEngine();
          const touchpoints = parameters.touchpoints as Touchpoint[];
          const paths = parameters.paths as ConversionPath[];
          if (!touchpoints || !paths) {
            return failResult(
              "Missing required parameters",
              "validation",
              "touchpoints and paths are required",
            );
          }
          const result = engine.compareModels(touchpoints, paths);
          const modelCount = result.modelComparison
            ? new Set(result.modelComparison.map((m) => m.model)).size
            : 0;
          return {
            success: true,
            summary: `Attribution model comparison: ${modelCount} models compared across ${result.channelAttribution.length} channel(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to compare attribution models: ${err instanceof Error ? err.message : String(err)}`,
            "attribution.compare_models",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.attribution.channel_roles": {
        const start = Date.now();
        try {
          const engine = new MultiTouchAttributionEngine();
          const touchpoints = parameters.touchpoints as Touchpoint[];
          if (!touchpoints) {
            return failResult(
              "Missing required parameters",
              "validation",
              "touchpoints is required",
            );
          }
          const roles = engine.identifyChannelRoles(touchpoints);
          return {
            success: true,
            summary: `Channel role analysis: ${roles.length} channel(s) classified`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: roles,
          };
        } catch (err) {
          return failResult(
            `Failed to identify channel roles: ${err instanceof Error ? err.message : String(err)}`,
            "attribution.channel_roles",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Pacing actions (Phase 10) ---
      case "digital-ads.pacing.check": {
        const start = Date.now();
        try {
          const flightId = String(parameters.flightId ?? "");
          const flight = this.flightManager.getFlight(flightId);
          if (!flight) {
            return failResult(`Flight plan not found: ${flightId}`, "pacing.check", "No flight plan with that ID");
          }
          const apiConfig = this.getMetaApiConfig();
          if (!apiConfig) return this.noApiConfigResult();
          const pacingMonitor = new PacingMonitor(apiConfig.baseUrl, apiConfig.accessToken);
          const status = await pacingMonitor.checkPacing(flight);
          return {
            success: true,
            summary: `Pacing check: ${status.status} (${(status.pacingRatio * 100).toFixed(1)}% of planned), ${status.daysRemaining} days remaining`,
            externalRefs: { flightId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: status,
          };
        } catch (err) {
          return failResult(
            `Failed to check pacing: ${err instanceof Error ? err.message : String(err)}`,
            "pacing.check",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Alerting actions (Phase 11) ---
      case "digital-ads.alert.anomaly_scan": {
        const start = Date.now();
        try {
          const detector = new AnomalyDetector();
          const dailyMetrics = (parameters.dailyMetrics ?? []) as Array<{
            date: string; spend: number; impressions: number;
            clicks: number; conversions: number; ctr: number; cpm: number; cpa: number | null;
          }>;
          if (dailyMetrics.length < 3) {
            return failResult(
              "Not enough data for anomaly detection (need at least 3 data points)",
              "validation",
              "Provide at least 3 dailyMetrics data points",
            );
          }
          const anomalies = detector.scan(dailyMetrics);
          return {
            success: true,
            summary: `Anomaly scan: ${anomalies.length} anomal${anomalies.length === 1 ? "y" : "ies"} detected across ${dailyMetrics.length} days`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: anomalies,
          };
        } catch (err) {
          return failResult(
            `Failed to scan anomalies: ${err instanceof Error ? err.message : String(err)}`,
            "alert.anomaly_scan",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.alert.budget_forecast": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const forecaster = new BudgetForecaster(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const forecasts = await forecaster.forecast(adAccountId);
          const exhaustingSoon = forecasts.filter((f) => f.daysUntilExhaustion !== null && f.daysUntilExhaustion <= 7);
          return {
            success: true,
            summary: `Budget forecast: ${forecasts.length} campaign(s) analyzed, ${exhaustingSoon.length} exhausting within 7 days`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: forecasts,
          };
        } catch (err) {
          return failResult(
            `Failed to forecast budgets: ${err instanceof Error ? err.message : String(err)}`,
            "alert.budget_forecast",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.alert.policy_scan": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const scanner = new PolicyScanner(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const scanResult = await scanner.scan(adAccountId);
          return {
            success: true,
            summary: `Policy scan: ${scanResult.disapprovedAds.length} disapproved ad(s), ${scanResult.policyWarnings.length} warning(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: scanResult,
          };
        } catch (err) {
          return failResult(
            `Failed to scan policies: ${err instanceof Error ? err.message : String(err)}`,
            "alert.policy_scan",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Notification delivery (Phase 14) ---
      case "digital-ads.alert.send_notifications": {
        const start = Date.now();
        try {
          if (this.notificationChannels.length === 0) {
            return failResult(
              "No notification channels configured",
              "validation",
              "Run digital-ads.alert.configure_notifications first to set up channels.",
            );
          }
          const dispatcher = new NotificationDispatcher(this.notificationChannels);
          const accountId = (parameters.accountId as string) ?? "unknown";
          const alertType = parameters.alertType as string | undefined;
          const allResults: Array<Record<string, unknown>> = [];

          // Dispatch anomaly alerts if requested or all
          if (!alertType || alertType === "anomaly") {
            const anomalies = (parameters.anomalies ?? []) as Array<Record<string, unknown>>;
            if (anomalies.length > 0) {
              const results = await dispatcher.dispatchAnomalyAlerts(
                accountId,
                anomalies as unknown as import("../alerting/types.js").AnomalyResult[],
              );
              allResults.push(...results.map((r) => ({ type: "anomaly", ...r } as unknown as Record<string, unknown>)));
            }
          }

          // Dispatch budget alerts if requested or all
          if (!alertType || alertType === "budget_forecast") {
            const forecasts = (parameters.forecasts ?? []) as Array<Record<string, unknown>>;
            if (forecasts.length > 0) {
              const results = await dispatcher.dispatchBudgetAlerts(
                accountId,
                forecasts as unknown as import("../alerting/types.js").BudgetForecast[],
              );
              allResults.push(...results.map((r) => ({ type: "budget", ...r } as unknown as Record<string, unknown>)));
            }
          }

          // Dispatch policy alerts if requested or all
          if (!alertType || alertType === "policy_violation") {
            const scanResult = parameters.scanResult as Record<string, unknown> | undefined;
            if (scanResult) {
              const results = await dispatcher.dispatchPolicyAlerts(
                accountId,
                scanResult as unknown as import("../alerting/types.js").PolicyScanResult,
              );
              allResults.push(...results.map((r) => ({ type: "policy", ...r } as unknown as Record<string, unknown>)));
            }
          }

          return {
            success: true,
            summary: `Dispatched ${allResults.length} notification(s) to ${this.notificationChannels.length} channel(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: { dispatched: allResults.length, results: allResults },
          };
        } catch (err) {
          return failResult(
            `Failed to send notifications: ${err instanceof Error ? err.message : String(err)}`,
            "alert.send_notifications",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Forecasting actions (Phase 12) ---
      case "digital-ads.forecast.budget_scenario": {
        const start = Date.now();
        try {
          const modeler = new ScenarioModeler();
          const currentSpend = Number(parameters.currentSpend ?? 0);
          const currentConversions = Number(parameters.currentConversions ?? 0);
          const currentCPA = Number(parameters.currentCPA ?? 0);
          const scenarioBudgets = (parameters.scenarioBudgets ?? []) as number[];
          if (!currentSpend || !currentConversions || scenarioBudgets.length === 0) {
            return failResult(
              "Missing required scenario parameters",
              "validation",
              "currentSpend, currentConversions, and scenarioBudgets are required",
            );
          }
          const scenarios = modeler.model({
            currentSpend,
            currentConversions,
            currentCPA,
            scenarioBudgets,
          });
          return {
            success: true,
            summary: `Budget scenario: ${scenarios.length} scenario(s) modeled`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: scenarios,
          };
        } catch (err) {
          return failResult(
            `Failed to model budget scenarios: ${err instanceof Error ? err.message : String(err)}`,
            "forecast.budget_scenario",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.forecast.diminishing_returns": {
        const start = Date.now();
        try {
          const analyzer = new DiminishingReturnsAnalyzer();
          const dataPoints = (parameters.dataPoints ?? []) as Array<{ spend: number; conversions: number }>;
          if (dataPoints.length < 3) {
            return failResult(
              "Not enough data for diminishing returns analysis (need at least 3 data points)",
              "validation",
              "Provide at least 3 dataPoints",
            );
          }
          const result = analyzer.analyze(dataPoints);
          const optStr = result.optimalSpend !== null ? `$${result.optimalSpend.toFixed(2)}` : "N/A";
          const satStr = result.saturationPoint !== null ? `$${result.saturationPoint.toFixed(2)}` : "N/A";
          return {
            success: true,
            summary: `Diminishing returns: optimal spend ${optStr}, saturation at ${satStr}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to analyze diminishing returns: ${err instanceof Error ? err.message : String(err)}`,
            "forecast.diminishing_returns",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Annual Planning actions ---
      case "digital-ads.plan.annual": {
        const start = Date.now();
        try {
          const planner = new AnnualPlanner();
          const planParams: AnnualPlanParams = {
            totalAnnualBudget: Number(parameters.totalAnnualBudget ?? 0),
            vertical: (parameters.vertical as "commerce" | "leadgen" | "brand") ?? "commerce",
            businessGoal: (parameters.businessGoal as string) ?? "",
            currentMonthlyCPA: Number(parameters.currentMonthlyCPA ?? 0),
            currentMonthlyConversions: Number(parameters.currentMonthlyConversions ?? 0),
            currentMonthlySpend: Number(parameters.currentMonthlySpend ?? 0),
            currentROAS: parameters.currentROAS != null ? Number(parameters.currentROAS) : undefined,
            targetAnnualGrowth: parameters.targetAnnualGrowth != null ? Number(parameters.targetAnnualGrowth) : undefined,
            targetCPA: parameters.targetCPA != null ? Number(parameters.targetCPA) : undefined,
            historicalMonthlyData: parameters.historicalMonthlyData as AnnualPlanParams["historicalMonthlyData"],
            frontLoadBudget: parameters.frontLoadBudget as boolean | undefined,
            aggressiveScaling: parameters.aggressiveScaling as boolean | undefined,
          };
          if (!planParams.totalAnnualBudget || !planParams.currentMonthlyCPA || !planParams.currentMonthlyConversions) {
            return failResult(
              "Missing required annual plan parameters",
              "validation",
              "totalAnnualBudget, currentMonthlyCPA, and currentMonthlyConversions are required",
            );
          }
          const plan = planner.createAnnualPlan(planParams);
          return {
            success: true,
            summary: `Annual plan: $${plan.totalAnnualBudget.toLocaleString()} budget across 4 quarters, projecting ${Math.round(plan.projectedAnnualConversions).toLocaleString()} conversions at $${plan.projectedAnnualCPA.toFixed(2)} CPA`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: plan,
          };
        } catch (err) {
          return failResult(
            `Failed to create annual plan: ${err instanceof Error ? err.message : String(err)}`,
            "plan.annual",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.plan.quarterly": {
        const start = Date.now();
        try {
          const planner = new AnnualPlanner();
          const targetQuarter = (parameters.quarter as string) ?? "Q1";
          const planParams: AnnualPlanParams = {
            totalAnnualBudget: Number(parameters.totalAnnualBudget ?? 0),
            vertical: (parameters.vertical as "commerce" | "leadgen" | "brand") ?? "commerce",
            businessGoal: (parameters.businessGoal as string) ?? "",
            currentMonthlyCPA: Number(parameters.currentMonthlyCPA ?? 0),
            currentMonthlyConversions: Number(parameters.currentMonthlyConversions ?? 0),
            currentMonthlySpend: Number(parameters.currentMonthlySpend ?? 0),
            currentROAS: parameters.currentROAS != null ? Number(parameters.currentROAS) : undefined,
            targetAnnualGrowth: parameters.targetAnnualGrowth != null ? Number(parameters.targetAnnualGrowth) : undefined,
            targetCPA: parameters.targetCPA != null ? Number(parameters.targetCPA) : undefined,
            historicalMonthlyData: parameters.historicalMonthlyData as AnnualPlanParams["historicalMonthlyData"],
            frontLoadBudget: parameters.frontLoadBudget as boolean | undefined,
            aggressiveScaling: parameters.aggressiveScaling as boolean | undefined,
          };
          if (!planParams.totalAnnualBudget || !planParams.currentMonthlyCPA || !planParams.currentMonthlyConversions) {
            return failResult(
              "Missing required plan parameters",
              "validation",
              "totalAnnualBudget, currentMonthlyCPA, and currentMonthlyConversions are required",
            );
          }
          const fullPlan = planner.createAnnualPlan(planParams);
          const quarter = fullPlan.quarters.find((q) => q.quarter === targetQuarter);
          if (!quarter) {
            return failResult(
              `Quarter ${targetQuarter} not found`,
              "validation",
              "quarter must be Q1, Q2, Q3, or Q4",
            );
          }
          return {
            success: true,
            summary: `${targetQuarter} plan: $${quarter.totalBudget.toLocaleString()} budget, projecting ${Math.round(quarter.projectedConversions).toLocaleString()} conversions at $${quarter.projectedCPA.toFixed(2)} CPA — "${quarter.strategicTheme}"`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: quarter,
          };
        } catch (err) {
          return failResult(
            `Failed to create quarterly plan: ${err instanceof Error ? err.message : String(err)}`,
            "plan.quarterly",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Catalog actions (Phase 13) ---
      case "digital-ads.catalog.health": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const checker = new CatalogHealthChecker(apiConfig.baseUrl, apiConfig.accessToken);
          const catalogId = parameters.catalogId as string;
          if (!catalogId) return failResult("Missing catalogId", "validation", "catalogId is required");
          const health = await checker.check(catalogId);
          return {
            success: true,
            summary: `Catalog health: ${health.totalProducts} product(s), ${health.rejectedProducts} rejected, ${health.issues.length} issue(s)`,
            externalRefs: { catalogId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: health,
          };
        } catch (err) {
          return failResult(
            `Failed to check catalog health: ${err instanceof Error ? err.message : String(err)}`,
            "catalog.health",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Creative Testing Queue actions (Phase 15) ---
      case "digital-ads.creative.test_queue": {
        const start = Date.now();
        try {
          const statusFilter = parameters.status as string | undefined;
          const tests = this.creativeTestingQueue.listTests(
            statusFilter ? { status: statusFilter as "queued" | "running" | "concluded" | "cancelled" } : undefined,
          );
          const calendar = this.creativeTestingQueue.getCalendar(
            (parameters.weeks as number) ?? 8,
          );
          return {
            success: true,
            summary: `Creative test queue: ${tests.length} test(s), ${calendar.filter((e) => e.status === "available").length} available slot(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: { tests, calendar },
          };
        } catch (err) {
          return failResult(
            `Failed to get test queue: ${err instanceof Error ? err.message : String(err)}`,
            "creative.test_queue",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.creative.test_evaluate": {
        const start = Date.now();
        try {
          const testId = parameters.testId as string;
          if (!testId) return failResult("Missing testId", "validation", "testId is required");
          const variantMetrics = (parameters.variantMetrics ?? []) as VariantMetrics[];
          if (variantMetrics.length < 2) {
            return failResult(
              "At least 2 variant metrics are required for evaluation",
              "validation",
              "Provide variantMetrics array with at least 2 variants",
            );
          }
          const result = this.creativeTestingQueue.evaluateTest(testId, variantMetrics);
          return {
            success: true,
            summary: result.statisticalSignificance
              ? `Test ${testId} has a winner: ${result.winnerVariantId} (p=${result.pValue.toFixed(4)})`
              : `Test ${testId}: no significant winner yet (p=${result.pValue.toFixed(4)})`,
            externalRefs: { testId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to evaluate test: ${err instanceof Error ? err.message : String(err)}`,
            "creative.test_evaluate",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.creative.power_calculate": {
        const start = Date.now();
        try {
          const baselineRate = parameters.baselineRate as number;
          const minimumDetectableEffect = parameters.minimumDetectableEffect as number;
          if (baselineRate === undefined || minimumDetectableEffect === undefined) {
            return failResult(
              "Missing baselineRate or minimumDetectableEffect",
              "validation",
              "baselineRate and minimumDetectableEffect are required",
            );
          }
          const result = this.creativeTestingQueue.calculatePower({
            baselineRate,
            minimumDetectableEffect,
            significanceLevel: parameters.significanceLevel as number | undefined,
            power: parameters.power as number | undefined,
            numVariants: parameters.numVariants as number | undefined,
            estimatedDailyTraffic: parameters.estimatedDailyTraffic as number | undefined,
            estimatedCPM: parameters.estimatedCPM as number | undefined,
          });
          return {
            success: true,
            summary: `Power calculation: need ${result.requiredSamplesPerVariant.toLocaleString()} samples/variant, ~${result.estimatedDaysToReach} days, ~$${result.totalEstimatedBudget.toFixed(2)} total budget`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to calculate power: ${err instanceof Error ? err.message : String(err)}`,
            "creative.power_calculate",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Cross-Platform Deduplication actions ---
      case "digital-ads.deduplication.analyze": {
        const start = Date.now();
        try {
          const dedupPlatforms = parameters.platforms as PlatformConversionData[] | undefined;
          if (!dedupPlatforms || !Array.isArray(dedupPlatforms) || dedupPlatforms.length < 2) {
            return failResult(
              "At least 2 platform datasets are required for deduplication analysis",
              "validation",
              "Provide a 'platforms' array with at least 2 PlatformConversionData entries",
            );
          }
          const dedupConfig = parameters.config as OverlapEstimationConfig | undefined;
          const deduplicator = new ConversionDeduplicator();
          const dedupResult = deduplicator.deduplicate(dedupPlatforms, dedupConfig);
          return {
            success: true,
            summary: `Deduplication analysis: ${dedupResult.naiveTotal.conversions.toLocaleString()} naive → ${dedupResult.deduplicatedTotal.conversions.toLocaleString()} deduplicated (${dedupResult.overcountingFactor.toFixed(2)}x overcounting), blended CPA $${dedupResult.deduplicatedTotal.blendedCPA.toFixed(2)}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: dedupResult,
          };
        } catch (err) {
          return failResult(
            `Failed to run deduplication analysis: ${err instanceof Error ? err.message : String(err)}`,
            "deduplication.analyze",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.deduplication.estimate_overlap": {
        const start = Date.now();
        try {
          const dedupP1 = parameters.platform1 as PlatformConversionData | undefined;
          const dedupP2 = parameters.platform2 as PlatformConversionData | undefined;
          if (!dedupP1 || !dedupP2) {
            return failResult(
              "Both platform1 and platform2 are required",
              "validation",
              "Provide platform1 and platform2 as PlatformConversionData objects",
            );
          }
          const dedupMethod = (parameters.method as string) ?? "hybrid";
          const deduplicator = new ConversionDeduplicator();
          const overlapResult = deduplicator.estimatePairwiseOverlap(dedupP1, dedupP2, dedupMethod);
          return {
            success: true,
            summary: `Overlap estimate (${dedupP1.platform} + ${dedupP2.platform}): ${(overlapResult.overlapRate * 100).toFixed(1)}% overlap (~${overlapResult.overlappingConversions} shared conversions) [${overlapResult.confidence} confidence, ${overlapResult.method}]`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: overlapResult,
          };
        } catch (err) {
          return failResult(
            `Failed to estimate overlap: ${err instanceof Error ? err.message : String(err)}`,
            "deduplication.estimate_overlap",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Account Memory actions (reads) ---
      case "digital-ads.memory.insights": {
        const start = Date.now();
        try {
          const accountId = parameters.accountId as string;
          if (!accountId) return failResult("Missing accountId", "validation", "accountId is required");
          const snapshot = this.accountMemory.getAccountInsights(accountId);
          return {
            success: true,
            summary: `Account memory insights: ${snapshot.totalRecords} record(s), ${snapshot.insights.length} action type(s), ${(snapshot.overallSuccessRate * 100).toFixed(0)}% overall success rate`,
            externalRefs: { accountId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: snapshot,
          };
        } catch (err) {
          return failResult(
            `Failed to get account insights: ${err instanceof Error ? err.message : String(err)}`,
            "memory.insights",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.memory.list": {
        const start = Date.now();
        try {
          const accountId = parameters.accountId as string;
          if (!accountId) return failResult("Missing accountId", "validation", "accountId is required");
          const records = this.accountMemory.listRecords(accountId, {
            actionType: parameters.actionType as OptimizationActionType | undefined,
            entityId: parameters.entityId as string | undefined,
            status: parameters.status as "positive" | "negative" | "neutral" | "pending" | undefined,
            limit: parameters.limit as number | undefined,
          });
          return {
            success: true,
            summary: `Listed ${records.length} optimization record(s) for account ${accountId}`,
            externalRefs: { accountId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: records,
          };
        } catch (err) {
          return failResult(
            `Failed to list records: ${err instanceof Error ? err.message : String(err)}`,
            "memory.list",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.memory.recommend": {
        const start = Date.now();
        try {
          const accountId = parameters.accountId as string;
          const proposedAction = parameters.proposedAction as OptimizationActionType;
          if (!accountId || !proposedAction) {
            return failResult("Missing accountId or proposedAction", "validation", "accountId and proposedAction are required");
          }
          const recommendation = this.accountMemory.getRecommendation(
            accountId,
            proposedAction,
            parameters.entityId as string | undefined,
          );
          return {
            success: true,
            summary: `Memory recommendation for ${proposedAction}: ${recommendation.confidence} confidence, ${(recommendation.historicalSuccessRate * 100).toFixed(0)}% historical success, trend: ${recommendation.recentTrend}`,
            externalRefs: { accountId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: recommendation,
          };
        } catch (err) {
          return failResult(
            `Failed to get recommendation: ${err instanceof Error ? err.message : String(err)}`,
            "memory.recommend",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.memory.export": {
        const start = Date.now();
        try {
          const accountId = parameters.accountId as string;
          if (!accountId) return failResult("Missing accountId", "validation", "accountId is required");
          const exported = this.accountMemory.exportMemory(accountId);
          const parsed = JSON.parse(exported) as { recordCount: number };
          return {
            success: true,
            summary: `Exported ${parsed.recordCount} optimization record(s) for account ${accountId}`,
            externalRefs: { accountId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: exported,
          };
        } catch (err) {
          return failResult(
            `Failed to export memory: ${err instanceof Error ? err.message : String(err)}`,
            "memory.export",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Geo-Holdout Experiment actions (read) ---
      case "digital-ads.geo_experiment.design": {
        const start = Date.now();
        try {
          const name = parameters.name as string;
          const hypothesis = parameters.hypothesis as string;
          const availableRegions = parameters.availableRegions as import("../ab-testing/geo-experiment.js").GeoRegion[];
          const primaryMetric = (parameters.primaryMetric ?? "conversions") as "conversions" | "revenue" | "store_visits";
          const testDays = parameters.testDays as number;
          const treatmentBudgetPerDay = parameters.treatmentBudgetPerDay as number;
          if (!name || !hypothesis || !availableRegions || availableRegions.length < 2 || !testDays || !treatmentBudgetPerDay) {
            return failResult(
              "Missing required geo experiment design parameters",
              "validation",
              "name, hypothesis, availableRegions (>=2), testDays, and treatmentBudgetPerDay are required",
            );
          }
          const design = this.geoExperimentManager.designExperiment({
            name,
            hypothesis,
            availableRegions,
            primaryMetric,
            testDays,
            preTestDays: parameters.preTestDays as number | undefined,
            cooldownDays: parameters.cooldownDays as number | undefined,
            treatmentBudgetPerDay,
          });
          return {
            success: true,
            summary: `Geo experiment designed: "${design.name}" — ${design.treatmentRegions.length} treatment, ${design.holdoutRegions.length} holdout regions, ${design.testDays}-day test`,
            externalRefs: { experimentId: design.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: design,
          };
        } catch (err) {
          return failResult(
            `Failed to design geo experiment: ${err instanceof Error ? err.message : String(err)}`,
            "geo_experiment.design",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.geo_experiment.analyze": {
        const start = Date.now();
        try {
          const experimentId = parameters.experimentId as string;
          const regionMetrics = parameters.regionMetrics as GeoRegionMetrics[];
          if (!experimentId || !regionMetrics || regionMetrics.length === 0) {
            return failResult(
              "Missing experimentId or regionMetrics",
              "validation",
              "experimentId and regionMetrics array are required",
            );
          }
          const result = this.geoExperimentManager.analyzeResults(experimentId, regionMetrics);
          const sigText = result.significant ? "SIGNIFICANT" : "not significant";
          return {
            success: true,
            summary: `Geo experiment analysis: ${result.liftPercent.toFixed(1)}% lift (${sigText}, p=${result.pValue.toFixed(3)}), ${result.incrementalConversions.toFixed(0)} incremental conversions`,
            externalRefs: { experimentId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to analyze geo experiment: ${err instanceof Error ? err.message : String(err)}`,
            "geo_experiment.analyze",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.geo_experiment.power": {
        const start = Date.now();
        try {
          const baselineConversionRatePerRegion = parameters.baselineConversionRatePerRegion as number;
          const minimumDetectableLift = parameters.minimumDetectableLift as number;
          const numberOfRegions = parameters.numberOfRegions as number;
          if (baselineConversionRatePerRegion === undefined || minimumDetectableLift === undefined || !numberOfRegions) {
            return failResult(
              "Missing required power analysis parameters",
              "validation",
              "baselineConversionRatePerRegion, minimumDetectableLift, and numberOfRegions are required",
            );
          }
          const result = this.geoExperimentManager.calculateMinimumDuration({
            baselineConversionRatePerRegion,
            minimumDetectableLift,
            numberOfRegions,
            significanceLevel: parameters.significanceLevel as number | undefined,
            power: parameters.power as number | undefined,
          });
          return {
            success: true,
            summary: `Geo experiment power analysis: minimum ${result.minimumTestDays} test days needed for ${(minimumDetectableLift * 100).toFixed(1)}% detectable lift across ${numberOfRegions} regions`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to calculate power: ${err instanceof Error ? err.message : String(err)}`,
            "geo_experiment.power",
            err instanceof Error ? err.message : String(err),
          );
        }
      }


      // --- Custom KPI actions (read) ---
      case "digital-ads.kpi.list": {
        const start = Date.now();
        const definitions = this.kpiEngine.listKPIs();
        const presets = this.kpiEngine.getPresetKPIs();
        return {
          success: true,
          summary: `Listed ${definitions.length} registered KPI(s) and ${presets.length} available preset(s)`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: { registered: definitions, presets },
        };
      }
      case "digital-ads.kpi.compute": {
        const start = Date.now();
        try {
          const metrics = (parameters.metrics ?? {}) as Record<string, number>;
          const kpiId = parameters.kpiId as string | undefined;
          if (kpiId) {
            const result = this.kpiEngine.computeKPI(kpiId, metrics);
            return {
              success: true,
              summary: `KPI "${result.kpiName}": ${result.formattedValue} (${result.status})`,
              externalRefs: {},
              rollbackAvailable: false,
              partialFailures: [],
              durationMs: Date.now() - start,
              undoRecipe: null,
              data: result,
            };
          }
          const results = this.kpiEngine.computeAllKPIs(metrics);
          return {
            success: true,
            summary: `Computed ${results.length} KPI(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: results,
          };
        } catch (err) {
          return failResult(
            `Failed to compute KPI: ${err instanceof Error ? err.message : String(err)}`,
            "kpi.compute",
            err instanceof Error ? err.message : String(err),
          );
        }
      }


      // --- LTV Optimization actions (read) ---
      case "digital-ads.ltv.project": {
        const start = Date.now();
        try {
          const cohort = parameters.cohort as CustomerCohort;
          if (!cohort) {
            return failResult("Missing cohort data", "validation", "cohort (CustomerCohort) is required");
          }
          const optimizer = new LTVOptimizer();
          const projection = optimizer.projectLTV(cohort);
          return {
            success: true,
            summary: `LTV projection for cohort ${projection.cohortId}: $${projection.projectedLTV.toFixed(2)} projected LTV, ${projection.ltvToCACRatio.toFixed(1)}x LTV:CAC, ${projection.confidenceLevel} confidence (${projection.curveType} curve)`,
            externalRefs: { cohortId: projection.cohortId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: projection,
          };
        } catch (err) {
          return failResult(
            `Failed to project LTV: ${err instanceof Error ? err.message : String(err)}`,
            "ltv.project",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.ltv.optimize": {
        const start = Date.now();
        try {
          const cohorts = parameters.cohorts as CustomerCohort[];
          if (!cohorts || !Array.isArray(cohorts) || cohorts.length === 0) {
            return failResult("Missing cohorts data", "validation", "cohorts (CustomerCohort[]) is required and must be non-empty");
          }
          const targetRatio = parameters.targetLTVtoCACRatio as number | undefined;
          const optimizer = new LTVOptimizer();
          const result = optimizer.optimizeByCohortLTV(cohorts, targetRatio);
          const scaleCount = result.campaignRecommendations.filter((r) => r.action === "scale").length;
          const pauseCount = result.campaignRecommendations.filter((r) => r.action === "pause").length;
          return {
            success: true,
            summary: `LTV optimization: ${result.cohorts.length} cohort(s) analyzed, ${result.campaignRecommendations.length} campaign(s) — avg LTV $${result.insights.avgLTV.toFixed(2)}, ${scaleCount} to scale, ${pauseCount} to pause`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: result,
          };
        } catch (err) {
          return failResult(
            `Failed to optimize by LTV: ${err instanceof Error ? err.message : String(err)}`,
            "ltv.optimize",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.ltv.allocate": {
        const start = Date.now();
        try {
          const campaigns = parameters.campaigns as Array<{
            campaignId: string;
            campaignName: string;
            dailyBudget: number;
            cpa: number;
          }>;
          const cohorts = parameters.cohorts as CustomerCohort[];
          if (!campaigns || !Array.isArray(campaigns) || campaigns.length === 0) {
            return failResult("Missing campaigns data", "validation", "campaigns array is required and must be non-empty");
          }
          if (!cohorts || !Array.isArray(cohorts) || cohorts.length === 0) {
            return failResult("Missing cohorts data", "validation", "cohorts (CustomerCohort[]) is required and must be non-empty");
          }
          const totalBudget = parameters.totalBudget as number | undefined;
          const optimizer = new LTVOptimizer();
          const allocations = optimizer.allocateBudgetByLTV(campaigns, cohorts, totalBudget);
          const changed = allocations.filter((a) => Math.abs(a.changeDollars) > 1);
          const totalCurrent = allocations.reduce((s, a) => s + a.currentBudget, 0);
          const totalRecommended = allocations.reduce((s, a) => s + a.recommendedBudget, 0);
          return {
            success: true,
            summary: `LTV budget allocation: ${allocations.length} campaign(s), ${changed.length} with changes — $${totalCurrent.toFixed(2)} current → $${totalRecommended.toFixed(2)} recommended`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: allocations,
          };
        } catch (err) {
          return failResult(
            `Failed to allocate budget by LTV: ${err instanceof Error ? err.message : String(err)}`,
            "ltv.allocate",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Seasonal Calendar actions (reads) ---
      case "digital-ads.seasonal.calendar": {
        const start = Date.now();
        try {
          const vertical = parameters.vertical as string;
          if (!vertical) return failResult("Missing vertical", "validation", "vertical is required");
          const region = parameters.region as EventRegion | undefined;
          const calendar = this.seasonalCalendar.getAnnualCalendar(vertical, region);
          return {
            success: true,
            summary: `Generated 12-month seasonal calendar for ${vertical}${region ? ` (${region})` : ""}`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: { calendar },
          };
        } catch (err) {
          return failResult(
            `Failed to generate seasonal calendar: ${err instanceof Error ? err.message : String(err)}`,
            "seasonal.calendar",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.seasonal.events": {
        const start = Date.now();
        try {
          const region = parameters.region as EventRegion | undefined;
          const vertical = parameters.vertical as string | undefined;
          const month = parameters.month as number | undefined;
          const category = parameters.category as EventCategory | undefined;
          const events = this.seasonalCalendar.getEvents({ region, vertical, month, category });

          let profile = null;
          if (month !== undefined && vertical) {
            profile = this.seasonalCalendar.getMonthlyProfile(month, vertical, region);
          }

          return {
            success: true,
            summary: `Found ${events.length} seasonal events matching filters`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: { events, profile },
          };
        } catch (err) {
          return failResult(
            `Failed to query seasonal events: ${err instanceof Error ? err.message : String(err)}`,
            "seasonal.events",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      default:
        return failResult(`Unknown read action type: ${actionType}`, "dispatch", `Unknown read action type`);
    }
  }

  private async dispatchWriteAction(
    actionType: string,
    parameters: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    if (!this.writeProvider) {
      return failResult(
        "Write provider not configured",
        "resolve_provider",
        "No MetaAdsWriteProvider registered",
      );
    }

    switch (actionType) {
      // --- Existing write actions ---
      case "digital-ads.campaign.pause":
        return executeCampaignPause(parameters, this.writeProvider);
      case "digital-ads.campaign.resume":
        return executeCampaignResume(parameters, this.writeProvider);
      case "digital-ads.campaign.adjust_budget":
        return executeCampaignAdjustBudget(parameters, this.writeProvider);
      case "digital-ads.adset.pause":
        return executeAdSetPause(parameters, this.writeProvider);
      case "digital-ads.adset.resume":
        return executeAdSetResume(parameters, this.writeProvider);
      case "digital-ads.adset.adjust_budget":
        return executeAdSetAdjustBudget(parameters, this.writeProvider);
      case "digital-ads.targeting.modify":
        return executeTargetingModify(parameters, this.writeProvider);
      case "digital-ads.campaign.create":
        return executeCampaignCreate(parameters, this.writeProvider);
      case "digital-ads.adset.create":
        return executeAdSetCreate(parameters, this.writeProvider);
      case "digital-ads.ad.create":
        return executeAdCreate(parameters, this.writeProvider);

      // --- Audience writes (Phase 3) ---
      case "digital-ads.audience.custom.create": {
        try {
          const params = parameters as unknown as CreateCustomAudienceWriteParams;
          const result = await this.writeProvider.createCustomAudience(params);
          return {
            success: true,
            summary: `Created custom audience "${params.name}" (${result.id})`,
            externalRefs: { audienceId: result.id },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.audience.delete",
              reverseParameters: { audienceId: result.id },
              undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              undoRiskCategory: "medium",
              undoApprovalRequired: "none",
            },
          };
        } catch (err) {
          return failResult(
            `Failed to create custom audience: ${err instanceof Error ? err.message : String(err)}`,
            "audience.custom.create",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.audience.lookalike.create": {
        try {
          const params = parameters as unknown as CreateLookalikeAudienceWriteParams;
          const result = await this.writeProvider.createLookalikeAudience(params);
          return {
            success: true,
            summary: `Created lookalike audience "${params.name}" from source ${params.sourceAudienceId} (${params.ratio * 100}% in ${params.country})`,
            externalRefs: { audienceId: result.id },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.audience.delete",
              reverseParameters: { audienceId: result.id },
              undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              undoRiskCategory: "medium",
              undoApprovalRequired: "none",
            },
          };
        } catch (err) {
          return failResult(
            `Failed to create lookalike audience: ${err instanceof Error ? err.message : String(err)}`,
            "audience.lookalike.create",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.audience.delete": {
        const audienceId = parameters.audienceId as string;
        if (!audienceId) return failResult("Missing audienceId", "validation", "audienceId required");
        await this.writeProvider.deleteCustomAudience(audienceId);
        return {
          success: true,
          summary: `Deleted audience ${audienceId}`,
          externalRefs: { audienceId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: null,
        };
      }

      // --- Bid & Schedule writes (Phase 4) ---
      case "digital-ads.bid.update_strategy": {
        const adSetId = parameters.adSetId as string;
        const bidStrategy = parameters.bidStrategy as string;
        const bidAmount = parameters.bidAmount as number | undefined;
        if (!adSetId || !bidStrategy) {
          return failResult("Missing adSetId or bidStrategy", "validation", "adSetId and bidStrategy required");
        }
        try {
          const result = await this.writeProvider.updateBidStrategy(adSetId, bidStrategy, bidAmount);
          return {
            success: true,
            summary: `Updated bid strategy on ad set ${adSetId}: ${result.previousBidStrategy} → ${bidStrategy}`,
            externalRefs: { adSetId },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.bid.update_strategy",
              reverseParameters: { adSetId, bidStrategy: result.previousBidStrategy },
              undoExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
              undoRiskCategory: "high",
              undoApprovalRequired: "standard",
            },
          };
        } catch (err) {
          return failResult(
            `Failed to update bid strategy: ${err instanceof Error ? err.message : String(err)}`,
            "bid.update_strategy",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.budget.reallocate": {
        const allocations = parameters.allocations as Array<{ campaignId: string; newBudgetCents: number }>;
        if (!Array.isArray(allocations) || allocations.length === 0) {
          return failResult("Missing allocations", "validation", "allocations array required");
        }
        const results: Array<{ campaignId: string; previousBudget: number }> = [];
        const failures: Array<{ step: string; error: string }> = [];
        for (const alloc of allocations) {
          try {
            const r = await this.writeProvider.updateBudget(alloc.campaignId, alloc.newBudgetCents);
            results.push({ campaignId: alloc.campaignId, previousBudget: r.previousBudget });
          } catch (err) {
            failures.push({
              step: `update_budget_${alloc.campaignId}`,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return {
          success: failures.length === 0,
          summary: `Reallocated budget across ${results.length} campaign(s)${failures.length > 0 ? ` (${failures.length} failed)` : ""}`,
          externalRefs: { updatedCampaigns: JSON.stringify(results.map((r) => r.campaignId)) },
          rollbackAvailable: results.length > 0,
          partialFailures: failures,
          durationMs: 0,
          undoRecipe: results.length > 0
            ? {
                originalActionId: "",
                originalEnvelopeId: "",
                reverseActionType: "digital-ads.budget.reallocate",
                reverseParameters: {
                  allocations: results.map((r) => ({
                    campaignId: r.campaignId,
                    newBudgetCents: r.previousBudget,
                  })),
                },
                undoExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
                undoRiskCategory: "high",
                undoApprovalRequired: "standard",
              }
            : null,
        };
      }
      case "digital-ads.schedule.set": {
        const adSetId = parameters.adSetId as string;
        const schedule = parameters.schedule as Array<Record<string, unknown>>;
        if (!adSetId || !schedule) {
          return failResult("Missing adSetId or schedule", "validation", "adSetId and schedule required");
        }
        try {
          await this.writeProvider.updateAdSetSchedule(adSetId, schedule);
          return {
            success: true,
            summary: `Updated schedule on ad set ${adSetId} with ${schedule.length} time block(s)`,
            externalRefs: { adSetId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: null,
          };
        } catch (err) {
          return failResult(
            `Failed to set schedule: ${err instanceof Error ? err.message : String(err)}`,
            "schedule.set",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.campaign.update_objective": {
        const campaignId = parameters.campaignId as string;
        const objective = parameters.objective as string;
        if (!campaignId || !objective) {
          return failResult("Missing campaignId or objective", "validation", "campaignId and objective required");
        }
        try {
          const result = await this.writeProvider.updateCampaignObjective(campaignId, objective);
          return {
            success: true,
            summary: `Updated campaign ${campaignId} objective: ${result.previousObjective} → ${objective}`,
            externalRefs: { campaignId },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.campaign.update_objective",
              reverseParameters: { campaignId, objective: result.previousObjective },
              undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              undoRiskCategory: "critical",
              undoApprovalRequired: "elevated",
            },
          };
        } catch (err) {
          return failResult(
            `Failed to update objective: ${err instanceof Error ? err.message : String(err)}`,
            "campaign.update_objective",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Creative writes (Phase 5) ---
      case "digital-ads.creative.upload": {
        try {
          const params = parameters as unknown as CreateAdCreativeWriteParams;
          const result = await this.writeProvider.createAdCreative(params);
          return {
            success: true,
            summary: `Uploaded creative "${params.name}" (${result.id})`,
            externalRefs: { creativeId: result.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: null,
          };
        } catch (err) {
          return failResult(
            `Failed to upload creative: ${err instanceof Error ? err.message : String(err)}`,
            "creative.upload",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.creative.rotate": {
        const adsToPause = parameters.adsToPause as string[] | undefined;
        const adsToActivate = parameters.adsToActivate as string[] | undefined;
        const results: Array<{ adId: string; action: string; previousStatus: string }> = [];
        const failures: Array<{ step: string; error: string }> = [];

        for (const adId of adsToPause ?? []) {
          try {
            const r = await this.writeProvider.updateAdStatus(adId, "PAUSED");
            results.push({ adId, action: "paused", previousStatus: r.previousStatus });
          } catch (err) {
            failures.push({ step: `pause_${adId}`, error: err instanceof Error ? err.message : String(err) });
          }
        }
        for (const adId of adsToActivate ?? []) {
          try {
            const r = await this.writeProvider.updateAdStatus(adId, "ACTIVE");
            results.push({ adId, action: "activated", previousStatus: r.previousStatus });
          } catch (err) {
            failures.push({ step: `activate_${adId}`, error: err instanceof Error ? err.message : String(err) });
          }
        }

        return {
          success: failures.length === 0,
          summary: `Rotated creatives: ${results.filter((r) => r.action === "paused").length} paused, ${results.filter((r) => r.action === "activated").length} activated${failures.length > 0 ? ` (${failures.length} failed)` : ""}`,
          externalRefs: { rotatedAds: JSON.stringify(results) },
          rollbackAvailable: results.length > 0,
          partialFailures: failures,
          durationMs: 0,
          undoRecipe: results.length > 0
            ? {
                originalActionId: "",
                originalEnvelopeId: "",
                reverseActionType: "digital-ads.creative.rotate",
                reverseParameters: {
                  adsToPause: results.filter((r) => r.action === "activated").map((r) => r.adId),
                  adsToActivate: results.filter((r) => r.action === "paused").map((r) => r.adId),
                },
                undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                undoRiskCategory: "high",
                undoApprovalRequired: "standard",
              }
            : null,
        };
      }

      // --- Experiment writes (Phase 6) ---
      case "digital-ads.experiment.create": {
        try {
          const params = parameters as unknown as CreateAdStudyWriteParams;
          const result = await this.writeProvider.createAdStudy(params);
          return {
            success: true,
            summary: `Created A/B test "${params.name}" (${result.id})`,
            externalRefs: { studyId: result.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: null,
          };
        } catch (err) {
          return failResult(
            `Failed to create experiment: ${err instanceof Error ? err.message : String(err)}`,
            "experiment.create",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.experiment.conclude": {
        const studyId = parameters.studyId as string;
        const winnerCellId = parameters.winnerCellId as string;
        if (!studyId || !winnerCellId) {
          return failResult("Missing studyId or winnerCellId", "validation", "studyId and winnerCellId required");
        }
        await this.writeProvider.concludeExperiment(studyId, winnerCellId);
        return {
          success: true,
          summary: `Concluded experiment ${studyId} — winner: ${winnerCellId}, losers paused`,
          externalRefs: { studyId, winnerCellId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: null,
        };
      }

      // --- Optimization writes (Phase 7) ---
      case "digital-ads.optimization.apply": {
        const actions = parameters.actions as Array<{ actionType: string; parameters: Record<string, unknown> }>;
        if (!Array.isArray(actions) || actions.length === 0) {
          return failResult("Missing actions", "validation", "actions array required");
        }
        const results: Array<{ actionType: string; success: boolean }> = [];
        const failures: Array<{ step: string; error: string }> = [];
        for (const action of actions) {
          try {
            const r = await this.dispatchWriteAction(action.actionType, action.parameters);
            results.push({ actionType: action.actionType, success: r.success });
            if (!r.success) {
              failures.push({ step: action.actionType, error: r.summary });
            }
          } catch (err) {
            failures.push({ step: action.actionType, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return {
          success: failures.length === 0,
          summary: `Applied ${results.filter((r) => r.success).length}/${actions.length} optimization actions${failures.length > 0 ? ` (${failures.length} failed)` : ""}`,
          externalRefs: { appliedActions: JSON.stringify(results) },
          rollbackAvailable: false,
          partialFailures: failures,
          durationMs: 0,
          undoRecipe: null,
        };
      }
      case "digital-ads.rule.create": {
        try {
          const params = parameters as unknown as CreateAdRuleWriteParams;
          const result = await this.writeProvider.createAdRule(params);
          return {
            success: true,
            summary: `Created rule "${params.name}" (${result.id})`,
            externalRefs: { ruleId: result.id },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: 0,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.rule.delete",
              reverseParameters: { ruleId: result.id },
              undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              undoRiskCategory: "medium",
              undoApprovalRequired: "none",
            },
          };
        } catch (err) {
          return failResult(
            `Failed to create rule: ${err instanceof Error ? err.message : String(err)}`,
            "rule.create",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.rule.delete": {
        const ruleId = parameters.ruleId as string;
        if (!ruleId) return failResult("Missing ruleId", "validation", "ruleId required");
        await this.writeProvider.deleteAdRule(ruleId);
        return {
          success: true,
          summary: `Deleted rule ${ruleId}`,
          externalRefs: { ruleId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: null,
        };
      }

      // --- Guided Setup (Phase 8) ---
      case "digital-ads.campaign.setup_guided": {
        // Guided setup creates campaign + ad set + ad in sequence
        const objective = parameters.objective as string;
        const campaignName = parameters.campaignName as string;
        const dailyBudget = parameters.dailyBudget as number;
        const targeting = parameters.targeting as Record<string, unknown>;
        const creative = parameters.creative as Record<string, unknown>;
        const adSetName = parameters.adSetName as string | undefined;
        const adName = parameters.adName as string | undefined;

        if (!objective || !campaignName || !dailyBudget || !targeting || !creative) {
          return failResult(
            "Missing required guided setup parameters",
            "validation",
            "objective, campaignName, dailyBudget, targeting, and creative are required",
          );
        }

        const createdIds: Record<string, string> = {};
        const failures: Array<{ step: string; error: string }> = [];

        try {
          const campaign = await this.writeProvider.createCampaign({
            name: campaignName,
            objective,
            dailyBudget,
            status: "PAUSED",
          });
          createdIds.campaignId = campaign.id;

          const adSet = await this.writeProvider.createAdSet({
            campaignId: campaign.id,
            name: adSetName ?? `${campaignName} — Ad Set`,
            dailyBudget,
            targeting,
            status: "PAUSED",
          });
          createdIds.adSetId = adSet.id;

          const ad = await this.writeProvider.createAd({
            adSetId: adSet.id,
            name: adName ?? `${campaignName} — Ad`,
            creative,
            status: "PAUSED",
          });
          createdIds.adId = ad.id;
        } catch (err) {
          failures.push({
            step: "guided_setup",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return {
          success: failures.length === 0,
          summary: failures.length === 0
            ? `Guided setup complete: campaign ${createdIds.campaignId}, ad set ${createdIds.adSetId}, ad ${createdIds.adId} (all PAUSED)`
            : `Guided setup partially failed: ${failures[0]?.error}`,
          externalRefs: createdIds,
          rollbackAvailable: !!createdIds.campaignId,
          partialFailures: failures,
          durationMs: 0,
          undoRecipe: createdIds.campaignId
            ? {
                originalActionId: "",
                originalEnvelopeId: "",
                reverseActionType: "digital-ads.campaign.pause",
                reverseParameters: { campaignId: createdIds.campaignId },
                undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                undoRiskCategory: "low",
                undoApprovalRequired: "none",
              }
            : null,
        };
      }

      // --- Compliance writes (Phase 9) ---
      case "digital-ads.compliance.publisher_blocklist": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const manager = new PublisherBlocklistManager(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          if (!adAccountId) return failResult("Missing adAccountId", "validation", "adAccountId is required");
          const subAction = (parameters.action as string) ?? "list";
          if (subAction === "create") {
            const name = parameters.name as string;
            const publishers = parameters.publishers as string[];
            if (!name || !publishers) {
              return failResult("Missing name or publishers for blocklist creation", "validation", "name and publishers are required");
            }
            const blocklist = await manager.create(adAccountId, name, publishers);
            return {
              success: true,
              summary: `Created publisher blocklist "${name}" (${blocklist.id}) with ${publishers.length} publisher(s)`,
              externalRefs: { blocklistId: blocklist.id },
              rollbackAvailable: false,
              partialFailures: [],
              durationMs: Date.now() - start,
              undoRecipe: null,
            };
          }
          // Default: list
          const blocklists = await manager.list(adAccountId);
          return {
            success: true,
            summary: `Listed ${blocklists.length} publisher blocklist(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: blocklists,
          };
        } catch (err) {
          return failResult(
            `Failed to manage publisher blocklist: ${err instanceof Error ? err.message : String(err)}`,
            "compliance.publisher_blocklist",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.compliance.content_exclusions": {
        const start = Date.now();
        try {
          const campaignId = parameters.campaignId as string;
          if (!campaignId) return failResult("Missing campaignId", "validation", "campaignId is required");
          const excludedCategories = (parameters.excludedPublisherCategories ?? []) as string[];
          const filterLevel = (parameters.brandSafetyContentFilterLevel ?? "STANDARD") as string;

          // Content exclusions are stored as campaign metadata
          return {
            success: true,
            summary: `Content exclusions configured for campaign ${campaignId}: ${excludedCategories.length} categor(ies) excluded, filter level: ${filterLevel}`,
            externalRefs: { campaignId },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: {
              campaignId,
              excludedPublisherCategories: excludedCategories,
              brandSafetyContentFilterLevel: filterLevel,
            },
          };
        } catch (err) {
          return failResult(
            `Failed to configure content exclusions: ${err instanceof Error ? err.message : String(err)}`,
            "compliance.content_exclusions",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Measurement writes (Phase 9) ---
      case "digital-ads.measurement.lift_study.create": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const manager = new LiftStudyManager(apiConfig.baseUrl, apiConfig.accessToken);
          const adAccountId = parameters.adAccountId as string;
          const name = parameters.name as string;
          const startTime = parameters.startTime as number;
          const endTime = parameters.endTime as number;
          const cells = parameters.cells as Array<{ name: string; adSetIds?: string[]; campaignIds?: string[] }>;
          if (!adAccountId || !name || !startTime || !endTime || !cells) {
            return failResult(
              "Missing required lift study parameters",
              "validation",
              "adAccountId, name, startTime, endTime, and cells are required",
            );
          }
          const study = await manager.create(adAccountId, { name, startTime, endTime, cells });
          return {
            success: true,
            summary: `Created lift study "${name}" (${study.id}) with ${cells.length} cell(s)`,
            externalRefs: { studyId: study.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: study,
          };
        } catch (err) {
          return failResult(
            `Failed to create lift study: ${err instanceof Error ? err.message : String(err)}`,
            "measurement.lift_study.create",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Pacing writes (Phase 10) ---
      case "digital-ads.pacing.create_flight": {
        const start = Date.now();
        try {
          const flight = this.flightManager.createFlight({
            name: String(parameters.name ?? ""),
            campaignId: String(parameters.campaignId ?? ""),
            startDate: String(parameters.startDate ?? ""),
            endDate: String(parameters.endDate ?? ""),
            totalBudget: Number(parameters.totalBudget ?? 0),
            pacingCurve: (parameters.pacingCurve as "even" | "front-loaded" | "back-loaded") ?? undefined,
          });
          return {
            success: true,
            summary: `Created flight plan "${flight.name}" (${flight.id}) for campaign ${flight.campaignId}: $${flight.totalBudget} from ${flight.startDate} to ${flight.endDate}`,
            externalRefs: { flightId: flight.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: flight,
          };
        } catch (err) {
          return failResult(
            `Failed to create flight plan: ${err instanceof Error ? err.message : String(err)}`,
            "pacing.create_flight",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.pacing.auto_adjust": {
        const start = Date.now();
        try {
          const flightId = String(parameters.flightId ?? "");
          const flight = this.flightManager.getFlight(flightId);
          if (!flight) {
            return failResult(`Flight plan not found: ${flightId}`, "pacing.auto_adjust", "No flight plan with that ID");
          }
          const apiConfig = this.getMetaApiConfig();
          if (!apiConfig) return this.noApiConfigResult();
          const pacingMonitor = new PacingMonitor(apiConfig.baseUrl, apiConfig.accessToken);
          const pacingStatus = await pacingMonitor.checkPacing(flight);
          const adjustment = pacingMonitor.calculateAdjustment(pacingStatus);
          return {
            success: true,
            summary: `Pacing auto-adjust for "${flight.name}": ${pacingStatus.status}, recommended daily budget $${adjustment.recommendedDailyBudget.toFixed(2)}`,
            externalRefs: { flightId, campaignId: flight.campaignId },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.campaign.adjust_budget",
              reverseParameters: { campaignId: flight.campaignId, newBudget: adjustment.currentDailyBudget },
              undoExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
              undoRiskCategory: "high",
              undoApprovalRequired: "standard",
            },
            data: { status: pacingStatus, adjustment },
          };
        } catch (err) {
          return failResult(
            `Failed to auto-adjust pacing: ${err instanceof Error ? err.message : String(err)}`,
            "pacing.auto_adjust",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Catalog writes (Phase 13) ---
      case "digital-ads.catalog.product_sets": {
        const apiConfig = this.getMetaApiConfig();
        if (!apiConfig) return this.noApiConfigResult();
        const start = Date.now();
        try {
          const setManager = new ProductSetManager(apiConfig.baseUrl, apiConfig.accessToken);
          const catalogId = String(parameters.catalogId ?? "");
          if (!catalogId) return failResult("Missing catalogId", "validation", "catalogId is required");
          const actionMode = String(parameters.action ?? "list");
          if (actionMode === "create") {
            const name = parameters.name as string;
            const filter = (parameters.filter as Record<string, unknown>) ?? {};
            if (!name) return failResult("Missing name for product set creation", "validation", "name is required");
            const productSet = await setManager.create(catalogId, { name, filter });
            return {
              success: true,
              summary: `Created product set "${name}" (${productSet.id}) in catalog ${catalogId}`,
              externalRefs: { productSetId: productSet.id, catalogId },
              rollbackAvailable: false,
              partialFailures: [],
              durationMs: Date.now() - start,
              undoRecipe: null,
              data: productSet,
            };
          }
          const productSets = await setManager.list(catalogId);
          return {
            success: true,
            summary: `Listed ${productSets.length} product set(s) in catalog ${catalogId}`,
            externalRefs: { catalogId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: productSets,
          };
        } catch (err) {
          return failResult(
            `Failed to manage product sets: ${err instanceof Error ? err.message : String(err)}`,
            "catalog.product_sets",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Creative Testing Queue writes (Phase 15) ---
      case "digital-ads.creative.test_create": {
        const start = Date.now();
        try {
          const name = parameters.name as string;
          const hypothesis = parameters.hypothesis as string;
          const variants = parameters.variants as Array<{ variantId: string; description: string; adId?: string }>;
          const primaryMetric = (parameters.primaryMetric ?? "cpa") as "cpa" | "ctr" | "conversion_rate" | "roas";
          const minBudgetPerVariant = (parameters.minBudgetPerVariant as number) ?? 0;
          const scheduledStartDate = (parameters.scheduledStartDate as string) ?? null;

          if (!name || !hypothesis || !variants || variants.length < 2) {
            return failResult(
              "Missing required test parameters",
              "validation",
              "name, hypothesis, and at least 2 variants are required",
            );
          }

          const test = this.creativeTestingQueue.queueTest({
            name,
            hypothesis,
            variants,
            primaryMetric,
            scheduledStartDate,
            minBudgetPerVariant,
          });

          return {
            success: true,
            summary: `Queued creative test "${name}" (${test.id}) with ${variants.length} variants, primary metric: ${primaryMetric}`,
            externalRefs: { testId: test.id },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.creative.test_conclude",
              reverseParameters: { testId: test.id },
              undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              undoRiskCategory: "low",
              undoApprovalRequired: "none",
            },
            data: test,
          };
        } catch (err) {
          return failResult(
            `Failed to create test: ${err instanceof Error ? err.message : String(err)}`,
            "creative.test_create",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.creative.test_conclude": {
        const start = Date.now();
        try {
          const testId = parameters.testId as string;
          if (!testId) return failResult("Missing testId", "validation", "testId is required");

          const test = this.creativeTestingQueue.concludeTest(testId);
          const winnerSummary = test.winnerId
            ? ` — winner: ${test.winnerId}`
            : " — no winner declared";

          return {
            success: true,
            summary: `Concluded creative test "${test.name}" (${test.id})${winnerSummary}`,
            externalRefs: { testId: test.id, winnerId: test.winnerId ?? "" },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: test,
          };
        } catch (err) {
          return failResult(
            `Failed to conclude test: ${err instanceof Error ? err.message : String(err)}`,
            "creative.test_conclude",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Notification configuration (Phase 14) ---
      case "digital-ads.alert.configure_notifications": {
        const start = Date.now();
        try {
          const channels = parameters.channels as NotificationChannelConfig[] | undefined;
          if (!channels || !Array.isArray(channels) || channels.length === 0) {
            return failResult(
              "Missing or empty channels array",
              "validation",
              "Provide at least one notification channel configuration.",
            );
          }
          // Validate each channel has a type
          for (const ch of channels) {
            if (!ch.type || !["webhook", "slack", "email"].includes(ch.type)) {
              return failResult(
                `Invalid channel type: ${(ch as unknown as Record<string, unknown>).type}`,
                "validation",
                "Each channel must have type 'webhook', 'slack', or 'email'.",
              );
            }
          }
          const previousChannels = [...this.notificationChannels];
          this.notificationChannels = channels;
          return {
            success: true,
            summary: `Configured ${channels.length} notification channel(s): ${channels.map((c) => c.type).join(", ")}`,
            externalRefs: {},
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.alert.configure_notifications",
              reverseParameters: { channels: previousChannels },
              undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              undoRiskCategory: "low",
              undoApprovalRequired: "none",
            },
            data: { channelCount: channels.length, types: channels.map((c) => c.type) },
          };
        } catch (err) {
          return failResult(
            `Failed to configure notifications: ${err instanceof Error ? err.message : String(err)}`,
            "alert.configure_notifications",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Account Memory writes ---
      case "digital-ads.memory.record": {
        const start = Date.now();
        try {
          const accountId = parameters.accountId as string;
          const actionType = parameters.actionType as OptimizationActionType;
          const entityId = parameters.entityId as string;
          const entityType = parameters.entityType as OptimizationRecord['entityType'];
          const changeDescription = parameters.changeDescription as string;
          const params = parameters.parameters as Record<string, unknown>;
          const metricsBefore = parameters.metricsBefore as OptimizationRecord['metricsBefore'];
          if (!accountId || !actionType || !entityId || !entityType || !changeDescription || !metricsBefore) {
            return failResult(
              "Missing required fields for memory record",
              "validation",
              "accountId, actionType, entityId, entityType, changeDescription, and metricsBefore are required",
            );
          }
          const record = this.accountMemory.recordOptimization({
            accountId,
            actionType,
            entityId,
            entityType,
            changeDescription,
            parameters: params ?? {},
            metricsBefore,
            triggeringFinding: parameters.triggeringFinding as string | undefined,
          });
          return {
            success: true,
            summary: `Recorded optimization: ${actionType} on ${entityType} ${entityId} (record ${record.id})`,
            externalRefs: { recordId: record.id, accountId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: record,
          };
        } catch (err) {
          return failResult(
            `Failed to record optimization: ${err instanceof Error ? err.message : String(err)}`,
            "memory.record",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.memory.record_outcome": {
        const start = Date.now();
        try {
          const recordId = parameters.recordId as string;
          const metricsAfter = parameters.metricsAfter as OptimizationRecord['metricsAfter'];
          if (!recordId || !metricsAfter) {
            return failResult(
              "Missing recordId or metricsAfter",
              "validation",
              "recordId and metricsAfter are required",
            );
          }
          const record = this.accountMemory.recordOutcome(recordId, metricsAfter);
          const outcomeStr = record.outcome
            ? `${record.outcome.status} (${record.outcome.primaryMetricDeltaPercent > 0 ? '+' : ''}${record.outcome.primaryMetricDeltaPercent.toFixed(1)}%)`
            : 'pending';
          return {
            success: true,
            summary: `Recorded outcome for ${recordId}: ${outcomeStr}`,
            externalRefs: { recordId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: record,
          };
        } catch (err) {
          return failResult(
            `Failed to record outcome: ${err instanceof Error ? err.message : String(err)}`,
            "memory.record_outcome",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.memory.import": {
        const start = Date.now();
        try {
          const data = parameters.data as string;
          if (!data) {
            return failResult("Missing data", "validation", "data (JSON string) is required");
          }
          const imported = this.accountMemory.importMemory(data);
          return {
            success: true,
            summary: `Imported ${imported} optimization record(s)`,
            externalRefs: {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: { importedCount: imported },
          };
        } catch (err) {
          return failResult(
            `Failed to import memory: ${err instanceof Error ? err.message : String(err)}`,
            "memory.import",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Geo-Holdout Experiment writes ---
      case "digital-ads.geo_experiment.create": {
        const start = Date.now();
        try {
          const name = parameters.name as string;
          const hypothesis = parameters.hypothesis as string;
          const availableRegions = parameters.availableRegions as import("../ab-testing/geo-experiment.js").GeoRegion[];
          const primaryMetric = (parameters.primaryMetric ?? "conversions") as "conversions" | "revenue" | "store_visits";
          const testDays = parameters.testDays as number;
          const treatmentBudgetPerDay = parameters.treatmentBudgetPerDay as number;
          if (!name || !hypothesis || !availableRegions || availableRegions.length < 2 || !testDays || !treatmentBudgetPerDay) {
            return failResult(
              "Missing required geo experiment parameters",
              "validation",
              "name, hypothesis, availableRegions (>=2), testDays, and treatmentBudgetPerDay are required",
            );
          }
          const experiment = this.geoExperimentManager.designExperiment({
            name,
            hypothesis,
            availableRegions,
            primaryMetric,
            testDays,
            preTestDays: parameters.preTestDays as number | undefined,
            cooldownDays: parameters.cooldownDays as number | undefined,
            treatmentBudgetPerDay,
          });
          // Auto-start the experiment
          const started = this.geoExperimentManager.startExperiment(experiment.id);
          return {
            success: true,
            summary: `Created and started geo experiment "${started.name}" (${started.id}) — ${started.treatmentRegions.length} treatment, ${started.holdoutRegions.length} holdout regions`,
            externalRefs: { experimentId: started.id },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.geo_experiment.conclude",
              reverseParameters: { experimentId: started.id },
              undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              undoRiskCategory: "medium",
              undoApprovalRequired: "standard",
            },
            data: started,
          };
        } catch (err) {
          return failResult(
            `Failed to create geo experiment: ${err instanceof Error ? err.message : String(err)}`,
            "geo_experiment.create",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.geo_experiment.conclude": {
        const start = Date.now();
        try {
          const experimentId = parameters.experimentId as string;
          if (!experimentId) return failResult("Missing experimentId", "validation", "experimentId is required");
          const experiment = this.geoExperimentManager.concludeExperiment(experimentId);
          return {
            success: true,
            summary: `Concluded geo experiment "${experiment.name}" (${experiment.id})`,
            externalRefs: { experimentId: experiment.id },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: experiment,
          };
        } catch (err) {
          return failResult(
            `Failed to conclude geo experiment: ${err instanceof Error ? err.message : String(err)}`,
            "geo_experiment.conclude",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // --- Custom KPI actions (write) ---
      case "digital-ads.kpi.register": {
        const start = Date.now();
        try {
          const definition = parameters as unknown as Omit<CustomKPIDefinition, "id">;
          const registered = this.kpiEngine.registerKPI(definition);
          return {
            success: true,
            summary: `Registered custom KPI "${registered.name}" (${registered.id})`,
            externalRefs: { kpiId: registered.id },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.kpi.remove",
              reverseParameters: { kpiId: registered.id },
              undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              undoRiskCategory: "low",
              undoApprovalRequired: "none",
            },
          };
        } catch (err) {
          return failResult(
            `Failed to register KPI: ${err instanceof Error ? err.message : String(err)}`,
            "kpi.register",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      case "digital-ads.kpi.remove": {
        const start = Date.now();
        const kpiId = parameters.kpiId as string;
        if (!kpiId) return failResult("Missing kpiId", "validation", "kpiId is required");
        const removed = this.kpiEngine.removeKPI(kpiId);
        if (!removed) {
          return failResult(
            `KPI not found: ${kpiId}`,
            "kpi.remove",
            `No KPI with ID ${kpiId}`,
          );
        }
        return {
          success: true,
          summary: `Removed KPI ${kpiId}`,
          externalRefs: { kpiId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
        };
      }

      // --- Seasonal Calendar writes ---
      case "digital-ads.seasonal.add_event": {
        const start = Date.now();
        try {
          const name = parameters.name as string;
          const startMMDD = parameters.startMMDD as string;
          const endMMDD = parameters.endMMDD as string;
          const cpmThresholdMultiplier = parameters.cpmThresholdMultiplier as number;
          const cpaThresholdMultiplier = parameters.cpaThresholdMultiplier as number;
          const category = parameters.category as EventCategory;
          const region = parameters.region as EventRegion;
          const verticals = parameters.verticals as Array<"commerce" | "leadgen" | "brand" | "all">;
          const impact = (parameters.impact as string) ?? "";
          const recommendedActions = (parameters.recommendedActions as string[]) ?? [];

          if (!name || !startMMDD || !endMMDD || !cpmThresholdMultiplier || !cpaThresholdMultiplier || !category || !region || !verticals) {
            return failResult("Missing required fields", "validation", "name, startMMDD, endMMDD, cpmThresholdMultiplier, cpaThresholdMultiplier, category, region, and verticals are all required");
          }

          this.seasonalCalendar.addCustomEvent({
            name,
            startMMDD,
            endMMDD,
            cpmThresholdMultiplier,
            cpaThresholdMultiplier,
            category,
            region,
            verticals,
            impact,
            recommendedActions,
          });

          return {
            success: true,
            summary: `Added custom seasonal event "${name}" (${startMMDD} to ${endMMDD}, CPM x${cpmThresholdMultiplier})`,
            externalRefs: { eventName: name },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
          };
        } catch (err) {
          return failResult(
            `Failed to add custom seasonal event: ${err instanceof Error ? err.message : String(err)}`,
            "seasonal.add_event",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      default:
        return failResult(`Unknown action type: ${actionType}`, "dispatch", `Unknown action type`);
    }
  }

  async getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<RiskInput> {
    return computeRiskInput(actionType, parameters, context);
  }

  getGuardrails(): GuardrailConfig {
    return DEFAULT_DIGITAL_ADS_GUARDRAILS;
  }

  async healthCheck(): Promise<ConnectionHealth> {
    // Check write provider health first
    if (this.writeProvider) {
      return this.writeProvider.healthCheck();
    }

    // Fall back to diagnostic provider health
    const platforms = Array.from(this.session.connections.entries()).map(([platform, conn]) => ({
      platform,
      credentials: conn.credentials,
      entityId: conn.accountName ?? "",
    }));

    if (platforms.length === 0) {
      return {
        status: "disconnected",
        latencyMs: 0,
        error: null,
        capabilities: [],
      };
    }

    const result = await executeHealthCheck({ platforms }, this.providers);
    const healthData = result.data as HealthCheckResult | undefined;

    if (!healthData) {
      return {
        status: "disconnected",
        latencyMs: 0,
        error: null,
        capabilities: [],
      };
    }

    const avgLatency =
      healthData.platforms.length > 0
        ? Math.round(
            healthData.platforms.reduce((sum, p) => sum + p.latencyMs, 0) /
              healthData.platforms.length,
          )
        : 0;

    const firstError = healthData.platforms.find((p) => p.error)?.error ?? null;

    return {
      status: healthData.overall,
      latencyMs: avgLatency,
      error: firstError,
      capabilities: healthData.capabilities,
    };
  }

  async captureSnapshot(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    // For write actions, capture entity state before mutation
    if (!READ_ACTIONS.has(actionType) && this.writeProvider) {
      const campaignId = parameters.campaignId as string | undefined;
      const adSetId = parameters.adSetId as string | undefined;

      if (campaignId) {
        try {
          const campaign = await this.writeProvider.getCampaign(campaignId);
          return {
            campaignId,
            status: campaign.status,
            dailyBudget: campaign.dailyBudget / 100,
            deliveryStatus: campaign.deliveryStatus,
          };
        } catch {
          return { campaignId };
        }
      }

      if (adSetId) {
        try {
          const adSet = await this.writeProvider.getAdSet(adSetId);
          return {
            adSetId,
            status: adSet.status,
            dailyBudget: adSet.dailyBudget / 100,
            deliveryStatus: adSet.deliveryStatus,
          };
        } catch {
          return { adSetId };
        }
      }
    }

    return {};
  }

  /** Search campaigns via write provider (for entity resolution) */
  async searchCampaigns(query: string): Promise<CampaignInfo[]> {
    if (!this.writeProvider) return [];
    return this.writeProvider.searchCampaigns(query);
  }

  /** Resolve an entity reference to a campaign */
  async resolveEntity(
    inputRef: string,
    entityType: string,
    _context: Record<string, unknown>,
  ): Promise<import("@switchboard/schemas").ResolvedEntity> {
    if (!this.writeProvider) {
      return {
        id: "",
        inputRef,
        resolvedType: entityType,
        resolvedId: "",
        resolvedName: "",
        confidence: 0,
        alternatives: [],
        status: "not_found",
      };
    }

    const matches = await this.writeProvider.searchCampaigns(inputRef);

    if (matches.length === 1) {
      const match = matches[0]!;
      return {
        id: match.id,
        inputRef,
        resolvedType: entityType,
        resolvedId: match.id,
        resolvedName: match.name,
        confidence: 0.95,
        alternatives: [],
        status: "resolved",
      };
    }

    if (matches.length > 1) {
      return {
        id: "",
        inputRef,
        resolvedType: entityType,
        resolvedId: "",
        resolvedName: "",
        confidence: 0.5,
        alternatives: matches.map((m) => ({
          id: m.id,
          name: m.name,
          score: 0.5,
        })),
        status: "ambiguous",
      };
    }

    return {
      id: "",
      inputRef,
      resolvedType: entityType,
      resolvedId: "",
      resolvedName: "",
      confidence: 0,
      alternatives: [],
      status: "not_found",
    };
  }

  /** Get all captured snapshots */
  getCapturedSnapshots(): readonly CapturedSnapshot[] {
    return this.snapshots;
  }

  /** Expose session for testing */
  getSession(): SessionState {
    return this.session;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private resolveProvider(platform: PlatformType): AdPlatformProvider | undefined {
    return this.providers.get(platform);
  }

  private resolveCredentials(
    platform: PlatformType,
    context: CartridgeContext,
  ): PlatformCredentials | undefined {
    const ctxCreds = context.connectionCredentials?.[platform];
    if (ctxCreds) return ctxCreds as PlatformCredentials;
    return this.session.connections.get(platform)?.credentials;
  }

  private noProviderResult(platform: string): ExecuteResult {
    return failResult(
      `No provider registered for platform: ${platform}`,
      "resolve_provider",
      `Unknown platform: ${platform}`,
    );
  }
}
