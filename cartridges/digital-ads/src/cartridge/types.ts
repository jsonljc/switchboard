// ---------------------------------------------------------------------------
// Switchboard Cartridge — Contract Types
// ---------------------------------------------------------------------------
// Re-exports shared types from @switchboard/cartridge-sdk and
// @switchboard/schemas, plus defines digital-ads-specific domain types.
// ---------------------------------------------------------------------------

import type { PlatformType, PlatformCredentials } from "../platforms/types.js";
import type { VerticalType, EntityLevel, TimeRange } from "../core/types.js";

// ---------------------------------------------------------------------------
// Re-exports from SDK / Schemas (previously duplicated locally)
// ---------------------------------------------------------------------------

export type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
  ActionDefinition,
} from "@switchboard/schemas";

export type {
  ExecuteResult,
  Cartridge,
  CartridgeContext,
  CartridgeInterceptor,
} from "@switchboard/cartridge-sdk";

/** Re-export SDK UndoRecipe — all undo recipes use this format directly. */
export type { UndoRecipe } from "@switchboard/schemas";

/** Convenience alias for the partial failure shape used in ExecuteResult. */
export interface PartialFailure {
  step: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Digital-Ads extended context
// ---------------------------------------------------------------------------

import type { CartridgeContext } from "@switchboard/cartridge-sdk";

/**
 * Extended context for the digital-ads cartridge.
 * The extra optional fields are populated by enrichContext() and merged
 * into the context by the orchestrator before execute() is called.
 */
export interface DigitalAdsContext extends CartridgeContext {
  /** Session-level state (connections, cached data) */
  session?: SessionState;
  /** Resolved funnel schema (set by enrichContext for funnel.diagnose) */
  resolvedFunnel?: unknown;
  /** Resolved benchmarks (set by enrichContext for funnel.diagnose) */
  resolvedBenchmarks?: unknown;
  /** Resolved platform configs (set by enrichContext for portfolio.diagnose) */
  resolvedPlatforms?: Array<{ platform: string; funnel: unknown; benchmarks: unknown }>;
  /** Computed period length in days (set by enrichContext for snapshot.fetch) */
  periodDays?: number;
  /** Validation error from enrichContext — blocks execution when set */
  validationError?: string;
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export interface SessionState {
  /** Established platform connections */
  connections: Map<PlatformType, ConnectionState>;
}

export interface ConnectionState {
  platform: PlatformType;
  credentials: PlatformCredentials;
  status: "connected" | "disconnected" | "error";
  accountName?: string;
  entityLevels?: EntityLevel[];
  connectedAt: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Snapshot capture
// ---------------------------------------------------------------------------

export interface CapturedSnapshot {
  actionType: string;
  timestamp: number;
  parameters: Record<string, unknown>;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Action parameter types
// ---------------------------------------------------------------------------

export interface ConnectParams {
  platform: PlatformType;
  credentials: PlatformCredentials;
  entityId: string;
}

export interface DiagnoseFunnelParams {
  platform: PlatformType;
  entityId: string;
  entityLevel?: EntityLevel;
  vertical: VerticalType;
  periodDays?: number;
  referenceDate?: string;
  enableStructuralAnalysis?: boolean;
  enableHistoricalTrends?: boolean;
  targetROAS?: number;
}

export interface DiagnosePortfolioParams {
  name: string;
  vertical: VerticalType;
  platforms: Array<{
    platform: PlatformType;
    credentials: PlatformCredentials;
    entityId: string;
    entityLevel?: EntityLevel;
    enableStructuralAnalysis?: boolean;
    enableHistoricalTrends?: boolean;
    qualifiedLeadActionType?: string;
    targetROAS?: number;
  }>;
  periodDays?: number;
  referenceDate?: string;
}

export interface FetchSnapshotParams {
  platform: PlatformType;
  entityId: string;
  entityLevel?: EntityLevel;
  vertical: VerticalType;
  timeRange: TimeRange;
}

export interface AnalyzeStructureParams {
  platform: PlatformType;
  entityId: string;
  vertical: VerticalType;
  periodDays?: number;
}

export interface HealthCheckParams {
  platforms: Array<{
    platform: PlatformType;
    credentials: PlatformCredentials;
    entityId: string;
  }>;
}

// ---------------------------------------------------------------------------
// Campaign/Ad Set types (for write actions)
// ---------------------------------------------------------------------------

export interface CampaignInfo {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudget: number;
  lifetimeBudget: number | null;
  deliveryStatus: string | null;
  startTime: string | null;
  endTime: string | null;
  objective: string | null;
}

export interface AdSetInfo {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudget: number;
  lifetimeBudget: number | null;
  deliveryStatus: string | null;
  startTime: string | null;
  endTime: string | null;
  targeting: Record<string, unknown> | null;
  campaignId: string;
}

// ---------------------------------------------------------------------------
// Meta Ads write provider interface
// ---------------------------------------------------------------------------

export interface MetaAdsWriteProvider {
  getCampaign(campaignId: string): Promise<CampaignInfo>;
  searchCampaigns(query: string): Promise<CampaignInfo[]>;
  pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }>;
  resumeCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }>;
  updateBudget(
    campaignId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }>;
  getAdSet(adSetId: string): Promise<AdSetInfo>;
  pauseAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }>;
  resumeAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }>;
  updateAdSetBudget(
    adSetId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }>;
  updateTargeting(
    adSetId: string,
    targetingSpec: Record<string, unknown>,
  ): Promise<{ success: boolean }>;
  createCampaign(params: CreateCampaignParams): Promise<{ id: string; success: boolean }>;
  createAdSet(params: CreateAdSetParams): Promise<{ id: string; success: boolean }>;
  createAd(params: CreateAdParams): Promise<{ id: string; success: boolean }>;
  healthCheck(): Promise<import("@switchboard/schemas").ConnectionHealth>;
}

export interface CreateCampaignParams {
  name: string;
  objective: string;
  dailyBudget: number;
  status?: string;
  specialAdCategories?: string[];
}

export interface CreateAdSetParams {
  campaignId: string;
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  optimizationGoal?: string;
  billingEvent?: string;
  status?: string;
}

export interface CreateAdParams {
  adSetId: string;
  name: string;
  creative: Record<string, unknown>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Health check (domain-specific)
// ---------------------------------------------------------------------------

/** Internal per-platform health result used by the health-check action */
export interface PlatformHealth {
  platform: PlatformType;
  status: "connected" | "degraded" | "disconnected";
  latencyMs: number;
  error?: string;
  capabilities: string[];
}

export interface HealthCheckResult {
  overall: "connected" | "degraded" | "disconnected";
  platforms: PlatformHealth[];
  capabilities: string[];
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface PolicyConfig {
  id: string;
  name: string;
  description: string;
  allowedActions: string[];
  deniedActions: string[];
  maxRiskLevel: "none" | "low" | "medium" | "high" | "critical";
}

// ---------------------------------------------------------------------------
// Action types — read + write
// ---------------------------------------------------------------------------

export type ReadActionType =
  | "digital-ads.platform.connect"
  | "digital-ads.funnel.diagnose"
  | "digital-ads.portfolio.diagnose"
  | "digital-ads.snapshot.fetch"
  | "digital-ads.structure.analyze"
  | "digital-ads.health.check";

export type WriteActionType =
  | "digital-ads.campaign.pause"
  | "digital-ads.campaign.resume"
  | "digital-ads.campaign.adjust_budget"
  | "digital-ads.campaign.create"
  | "digital-ads.adset.pause"
  | "digital-ads.adset.resume"
  | "digital-ads.adset.adjust_budget"
  | "digital-ads.adset.create"
  | "digital-ads.ad.create"
  | "digital-ads.targeting.modify";

export type ActionType = ReadActionType | WriteActionType;

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

export interface ManifestValidationError {
  field: string;
  message: string;
  severity?: "error" | "warning";
}

const MANIFEST_ID_REGEX = /^[a-z][a-z0-9-]*$/;
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;
const ACTION_TYPE_REGEX = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*){1,4}$/;

export function validateManifest(
  manifest: import("@switchboard/schemas").CartridgeManifest,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push({ field: "id", message: "id is required and must be a string" });
  } else if (!MANIFEST_ID_REGEX.test(manifest.id)) {
    errors.push({
      field: "id",
      message: `id must match pattern ${MANIFEST_ID_REGEX} (got "${manifest.id}")`,
    });
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push({ field: "name", message: "name is required and must be a non-empty string" });
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push({ field: "version", message: "version is required and must be a string" });
  } else if (!VERSION_REGEX.test(manifest.version)) {
    errors.push({
      field: "version",
      message: `version must be valid semver (got "${manifest.version}")`,
    });
  }

  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push({ field: "description", message: "description is required and must be a string" });
  }
  if (!Array.isArray(manifest.requiredConnections)) {
    errors.push({ field: "requiredConnections", message: "requiredConnections must be an array" });
  } else if (manifest.requiredConnections.length === 0) {
    errors.push({
      field: "requiredConnections",
      message: "requiredConnections is empty",
      severity: "warning",
    });
  }
  if (!Array.isArray(manifest.defaultPolicies)) {
    errors.push({ field: "defaultPolicies", message: "defaultPolicies must be an array" });
  }
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) {
    errors.push({ field: "actions", message: "actions must be a non-empty array" });
  } else {
    const actionTypes = new Set<string>();
    for (const action of manifest.actions) {
      if (!action.actionType) {
        errors.push({ field: "actions", message: "each action must have an actionType" });
      } else {
        if (actionTypes.has(action.actionType)) {
          errors.push({ field: "actions", message: `duplicate action type: ${action.actionType}` });
        } else {
          actionTypes.add(action.actionType);
        }

        if (!ACTION_TYPE_REGEX.test(action.actionType)) {
          errors.push({
            field: `actions[${action.actionType}].actionType`,
            message: `actionType must match pattern ${ACTION_TYPE_REGEX} (got "${action.actionType}")`,
            severity: "warning",
          });
        }

        // Warn if action type prefix doesn't match manifest id
        const prefix = action.actionType.split(".")[0];
        if (prefix !== manifest.id) {
          errors.push({
            field: `actions[${action.actionType}].actionType`,
            message: `action type prefix "${prefix}" does not match manifest id "${manifest.id}"`,
            severity: "warning",
          });
        }
      }

      if (!action.name || typeof action.name !== "string") {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].name`,
          message: "action must have a name",
        });
      }

      if (!action.description) {
        errors.push({
          field: `actions[${action.actionType ?? "?"}]`,
          message: "action must have a description",
        });
      }

      const validRisks = ["none", "low", "medium", "high", "critical"];
      if (!validRisks.includes(action.baseRiskCategory)) {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].baseRiskCategory`,
          message: `invalid baseRiskCategory: ${action.baseRiskCategory}`,
        });
      }

      if (typeof action.reversible !== "boolean") {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].reversible`,
          message: "reversible must be a boolean",
        });
      }

      if (
        action.parametersSchema &&
        typeof action.parametersSchema === "object" &&
        Object.keys(action.parametersSchema).length === 0
      ) {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].parametersSchema`,
          message: "parametersSchema is empty",
          severity: "warning",
        });
      }
    }
  }

  return errors;
}
