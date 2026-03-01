// ---------------------------------------------------------------------------
// Switchboard Cartridge — Contract Types
// ---------------------------------------------------------------------------
// Defines the interfaces that any Switchboard cartridge must implement.
// These types are framework-level — the digital-ads cartridge
// implements them in index.ts.
// ---------------------------------------------------------------------------

import type { PlatformType, PlatformCredentials } from "../platforms/types.js";
import type { VerticalType, EntityLevel, TimeRange } from "../core/types.js";

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export interface ActionDefinition {
  /** Fully qualified action type (e.g. "digital-ads.funnel.diagnose") */
  actionType: string;
  /** Human-readable name for this action */
  name: string;
  /** Human-readable description of what this action does */
  description: string;
  /** JSON Schema for the action's parameters */
  parametersSchema: Record<string, unknown>;
  /** Base risk category for this action */
  baseRiskCategory: "none" | "low" | "medium" | "high" | "critical";
  /** Whether the action is reversible */
  reversible: boolean;
}

export interface CartridgeManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  requiredConnections: string[];
  defaultPolicies: string[];
  actions: ActionDefinition[];
}

// ---------------------------------------------------------------------------
// Cartridge context
// ---------------------------------------------------------------------------

export interface CartridgeContext {
  /** Principal (user) ID for audit/authorization */
  principalId: string;
  /** Organization ID, or null if not applicable */
  organizationId: string | null;
  /** Connection credentials keyed by connection name */
  connectionCredentials: Record<string, unknown>;
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
// Undo recipe
// ---------------------------------------------------------------------------

/** Re-export SDK UndoRecipe — all undo recipes use this format directly. */
export type { UndoRecipe } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Execution types
// ---------------------------------------------------------------------------

export interface PartialFailure {
  step: string;
  error: string;
}

export interface ExecuteResult {
  success: boolean;
  /** Human-readable summary of what happened */
  summary: string;
  /** External references for audit/tracking */
  externalRefs: Record<string, string>;
  /** Whether rollback is available (always false for read-only) */
  rollbackAvailable: boolean;
  /** Partial failures if some steps failed */
  partialFailures: PartialFailure[];
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Undo recipe in SDK format (null for read-only actions) */
  undoRecipe: import("@switchboard/schemas").UndoRecipe | null;
  /** The actual result data */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Risk types
// ---------------------------------------------------------------------------

export interface RiskExposure {
  dollarsAtRisk: number;
  blastRadius: number;
}

export interface RiskSensitivity {
  entityVolatile: boolean;
  learningPhase: boolean;
  recentlyModified: boolean;
}

export interface RiskInput {
  baseRisk: "none" | "low" | "medium" | "high" | "critical";
  exposure: RiskExposure;
  reversibility: "full" | "partial" | "none";
  sensitivity: RiskSensitivity;
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Scope: per-platform, per-entity, or global */
  scope: "platform" | "entity" | "global";
  /** Maximum actions in the window */
  maxActions: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export interface CooldownConfig {
  /** Action type this cooldown applies to */
  actionType: string;
  /** Cooldown duration in milliseconds */
  cooldownMs: number;
  /** Scope for the cooldown */
  scope: "entityId" | "platform" | "global";
}

export interface ProtectedEntity {
  entityType: string;
  entityId: string;
  reason: string;
}

export interface GuardrailConfig {
  rateLimits: RateLimitConfig[];
  cooldowns: CooldownConfig[];
  protectedEntities: ProtectedEntity[];
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface ConnectionHealth {
  status: "connected" | "degraded" | "disconnected";
  latencyMs: number;
  error: string | null;
  capabilities: string[];
}

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
  updateBudget(campaignId: string, newBudgetCents: number): Promise<{ success: boolean; previousBudget: number }>;
  getAdSet(adSetId: string): Promise<AdSetInfo>;
  pauseAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }>;
  resumeAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }>;
  updateAdSetBudget(adSetId: string, newBudgetCents: number): Promise<{ success: boolean; previousBudget: number }>;
  updateTargeting(adSetId: string, targetingSpec: Record<string, unknown>): Promise<{ success: boolean }>;
  healthCheck(): Promise<ConnectionHealth>;
}

// ---------------------------------------------------------------------------
// Interceptor
// ---------------------------------------------------------------------------

export interface CartridgeInterceptor {
  name: string;
  before?(
    actionType: string,
    params: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<void>;
  after?(actionType: string, result: ExecuteResult): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cartridge interface
// ---------------------------------------------------------------------------

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
  | "digital-ads.adset.pause"
  | "digital-ads.adset.resume"
  | "digital-ads.adset.adjust_budget"
  | "digital-ads.targeting.modify";

export type ActionType = ReadActionType | WriteActionType;

export interface Cartridge {
  readonly manifest: CartridgeManifest;

  /** Initialize the cartridge with context (credentials, config) */
  initialize(context: CartridgeContext): Promise<void>;

  /** Enrich context before execution (resolve funnels, benchmarks, etc.) */
  enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext
  ): Promise<Record<string, unknown>>;

  /** Execute an action */
  execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext
  ): Promise<ExecuteResult>;

  /** Get risk input for an action */
  getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<RiskInput>;

  /** Get guardrail configuration */
  getGuardrails(): GuardrailConfig;

  /** Check health of all configured platforms */
  healthCheck(): Promise<ConnectionHealth>;

  /** Capture a snapshot for audit/comparison (optional) */
  captureSnapshot?(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext
  ): Promise<Record<string, unknown>>;

  /** Search campaigns by query (optional, for entity resolution) */
  searchCampaigns?(query: string): Promise<unknown[]>;

  /** Resolve an entity reference (optional, for entity resolution) */
  resolveEntity?(
    inputRef: string,
    entityType: string,
    context: Record<string, unknown>
  ): Promise<unknown>;
}

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
  manifest: CartridgeManifest
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
