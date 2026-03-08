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

// Already-extracted action handlers
import { executeConnect } from "./actions/connect.js";
import { executeDiagnoseFunnel } from "./actions/diagnose-funnel.js";
import { executeDiagnosePortfolio } from "./actions/diagnose-portfolio.js";
import { executeFetchSnapshot } from "./actions/fetch-snapshot.js";
import { executeAnalyzeStructure } from "./actions/analyze-structure.js";
import { executeHealthCheck } from "./actions/health-check.js";
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

// Domain handler registries
import type { ActionHandler, HandlerContext } from "./actions/handler-context.js";
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

// Module instances used directly by the cartridge
import { FlightManager } from "../pacing/flight-manager.js";
import { CreativeTestingQueue } from "../creative/testing-queue.js";
import { CustomKPIEngine } from "../core/custom-kpi.js";
import { GeoExperimentManager } from "../ab-testing/geo-experiment.js";
import { AccountMemory } from "../core/account-memory.js";
import { SeasonalCalendar } from "../core/analysis/seasonality.js";
import type { NotificationChannelConfig } from "../notifications/types.js";
import type { MetaCredentials } from "../platforms/types.js";

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
// Combined handler registry — built once from all domain handler maps
// ---------------------------------------------------------------------------

function buildHandlerRegistry(): Map<string, ActionHandler> {
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
  private readonly handlerRegistry = buildHandlerRegistry();

  /** Register a diagnostic provider for a platform */
  registerProvider(provider: AdPlatformProvider): void {
    this.providers.set(provider.platform, provider);
  }

  /** Register a write provider (currently Meta only) */
  registerWriteProvider(provider: MetaAdsWriteProvider): void {
    this.writeProvider = provider;
  }

  /** Access the write provider (used by bootstrap to wire interceptors) */
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

      // Reporting — validate connection
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
      case "digital-ads.reach.estimate":
      case "digital-ads.creative.list":
      case "digital-ads.creative.analyze":
      case "digital-ads.experiment.check":
      case "digital-ads.experiment.list":
      case "digital-ads.rule.list":
      case "digital-ads.compliance.review_status":
      case "digital-ads.compliance.audit":
      case "digital-ads.measurement.lift_study.check":
      case "digital-ads.measurement.attribution.compare":
      case "digital-ads.measurement.mmm_export":
      case "digital-ads.alert.budget_forecast":
      case "digital-ads.alert.policy_scan":
      case "digital-ads.catalog.health":
      case "digital-ads.catalog.product_sets": {
        if (!this.session.connections.has("meta")) {
          enriched.validationError =
            "No Meta connection established. Run digital-ads.platform.connect first.";
        }
        break;
      }

      // Actions that require no API — local computation only
      case "digital-ads.strategy.recommend":
      case "digital-ads.strategy.mediaplan":
      case "digital-ads.budget.recommend":
      case "digital-ads.optimization.review":
      case "digital-ads.creative.generate":
      case "digital-ads.creative.score_assets":
      case "digital-ads.creative.generate_brief":
      case "digital-ads.alert.anomaly_scan":
      case "digital-ads.alert.send_notifications":
      case "digital-ads.alert.configure_notifications":
      case "digital-ads.forecast.budget_scenario":
      case "digital-ads.forecast.diminishing_returns":
      case "digital-ads.plan.annual":
      case "digital-ads.plan.quarterly":
      case "digital-ads.pacing.check":
      case "digital-ads.pacing.create_flight":
      case "digital-ads.pacing.auto_adjust":
      case "digital-ads.creative.test_queue":
      case "digital-ads.creative.test_evaluate":
      case "digital-ads.creative.test_create":
      case "digital-ads.creative.test_conclude":
      case "digital-ads.creative.power_calculate":
      case "digital-ads.attribution.multi_touch":
      case "digital-ads.attribution.compare_models":
      case "digital-ads.attribution.channel_roles":
      case "digital-ads.kpi.list":
      case "digital-ads.kpi.compute":
      case "digital-ads.kpi.register":
      case "digital-ads.kpi.remove":
      case "digital-ads.deduplication.analyze":
      case "digital-ads.deduplication.estimate_overlap":
      case "digital-ads.geo_experiment.design":
      case "digital-ads.geo_experiment.analyze":
      case "digital-ads.geo_experiment.power":
      case "digital-ads.geo_experiment.create":
      case "digital-ads.geo_experiment.conclude":
      case "digital-ads.memory.insights":
      case "digital-ads.memory.list":
      case "digital-ads.memory.recommend":
      case "digital-ads.memory.record":
      case "digital-ads.memory.record_outcome":
      case "digital-ads.memory.export":
      case "digital-ads.memory.import":
      case "digital-ads.ltv.project":
      case "digital-ads.ltv.optimize":
      case "digital-ads.ltv.allocate":
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
    // Already-extracted handlers (pre-existing per-file exports)
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
    }

    // Handler registry lookup for all other read actions
    const handler = this.handlerRegistry.get(actionType);
    if (handler) {
      return handler(parameters, this.buildHandlerContext());
    }

    return failResult(
      `Unknown read action type: ${actionType}`,
      "dispatch",
      `Unknown read action type`,
    );
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

    // Already-extracted write handlers
    switch (actionType) {
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
    }

    // Handler registry lookup for all other write actions
    const handler = this.handlerRegistry.get(actionType);
    if (handler) {
      return handler(parameters, this.buildHandlerContext());
    }

    return failResult(`Unknown action type: ${actionType}`, "dispatch", `Unknown action type`);
  }

  /** Build the handler context object for domain dispatch */
  private buildHandlerContext(): HandlerContext {
    return {
      apiConfig: this.getMetaApiConfig(),
      noApiConfigResult: () => this.noApiConfigResult(),
      flightManager: this.flightManager,
      creativeTestingQueue: this.creativeTestingQueue,
      kpiEngine: this.kpiEngine,
      geoExperimentManager: this.geoExperimentManager,
      accountMemory: this.accountMemory,
      seasonalCalendar: this.seasonalCalendar,
      notificationChannels: this.notificationChannels,
      setNotificationChannels: (channels) => {
        this.notificationChannels = channels;
      },
      writeProvider: this.writeProvider,
      dispatchWriteAction: (at, params) => this.dispatchWriteAction(at, params),
    };
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
          return { campaignId, error: "Could not capture pre-mutation state" };
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
          return { adSetId, error: "Could not capture pre-mutation state" };
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
      `No provider registered for platform "${platform}"`,
      "resolve_provider",
      `Register a provider for "${platform}" first`,
    );
  }
}
