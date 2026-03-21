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
  ResolvedEntity,
} from "@switchboard/schemas";
import type { HealthCheckResult } from "./types.js";
import type { PlatformType, PlatformCredentials } from "../platforms/types.js";
import type { AdPlatformProvider } from "./providers/provider.js";
import type { HandlerContext } from "./actions/handler-context.js";
import { DIGITAL_ADS_MANIFEST } from "./manifest.js";
import { DEFAULT_DIGITAL_ADS_GUARDRAILS } from "./defaults/guardrails.js";
import { computeRiskInput } from "./risk/categories.js";
import { createSessionState } from "./context/session.js";

// Extracted modules
import { isPlatformType, READ_ACTIONS, failResult, buildHandlerRegistry } from "./constants.js";
import { buildEnrichment } from "./enrich-context.js";
import {
  captureSnapshot as captureSnapshotFn,
  searchCampaigns as searchCampaignsFn,
  resolveEntity as resolveEntityFn,
} from "./entity-operations.js";

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
    return buildEnrichment(actionType, parameters, this.session, this.writeProvider);
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
    context: CartridgeContext,
  ): Promise<Record<string, unknown>> {
    return captureSnapshotFn(actionType, parameters, context, this.writeProvider);
  }

  /** Search campaigns via write provider (for entity resolution) */
  async searchCampaigns(query: string): Promise<CampaignInfo[]> {
    return searchCampaignsFn(query, this.writeProvider);
  }

  /** Resolve an entity reference to a campaign */
  async resolveEntity(
    inputRef: string,
    entityType: string,
    context: Record<string, unknown>,
  ): Promise<ResolvedEntity> {
    return resolveEntityFn(inputRef, entityType, context, this.writeProvider);
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
