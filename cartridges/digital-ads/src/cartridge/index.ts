// ---------------------------------------------------------------------------
// DigitalAdsCartridge — implements Cartridge
// ---------------------------------------------------------------------------
// The main cartridge class that routes actions to handlers, manages session
// state, provides risk/guardrail information, and supports both diagnostic
// (read) and mutation (write) actions.
// ---------------------------------------------------------------------------

import type {
  ReadActionType,
  Cartridge,
  CartridgeContext,
  CartridgeManifest,
  CapturedSnapshot,
  CampaignInfo,
  ConnectionHealth,
  ExecuteResult,
  GuardrailConfig,
  HealthCheckResult,
  MetaAdsWriteProvider,
  RiskInput,
  SessionState,
  ConnectParams,
  DiagnoseFunnelParams,
  DiagnosePortfolioParams,
  FetchSnapshotParams,
  AnalyzeStructureParams,
  HealthCheckParams,
} from "./types.js";
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
        const timeRange = parameters.timeRange as
          | { since?: string; until?: string }
          | undefined;
        if (timeRange) {
          if (!timeRange.since || !timeRange.until) {
            enriched.validationError =
              "timeRange requires both 'since' and 'until' dates";
          } else {
            const since = new Date(timeRange.since);
            const until = new Date(timeRange.until);
            if (since > until) {
              enriched.validationError =
                "timeRange.since must be before timeRange.until";
            }
            enriched.periodDays =
              Math.ceil(
                (until.getTime() - since.getTime()) / (1000 * 60 * 60 * 24),
              ) + 1;
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
            const campaign = await this.writeProvider.getCampaign(
              parameters.campaignId as string,
            );
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
            const adSet = await this.writeProvider.getAdSet(
              parameters.adSetId as string,
            );
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
    }

    return enriched;
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult> {
    // Check for validation errors
    if (typeof context.validationError === "string") {
      return failResult(
        `Validation failed: ${context.validationError}`,
        "validation",
        context.validationError,
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
      default:
        return failResult(
          `Unknown action type: ${actionType}`,
          "dispatch",
          `Unknown action type`,
        );
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
    const platforms = Array.from(this.session.connections.entries()).map(
      ([platform, conn]) => ({
        platform,
        credentials: conn.credentials,
        entityId: conn.accountName ?? "",
      }),
    );

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

    const firstError =
      healthData.platforms.find((p) => p.error)?.error ?? null;

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
