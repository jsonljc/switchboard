// ---------------------------------------------------------------------------
// Switchboard Cartridge — Contract Types
// ---------------------------------------------------------------------------
// Re-exports shared types from @switchboard/cartridge-sdk and
// @switchboard/schemas, plus defines digital-ads-specific domain types.
//
// Action type unions → action-types.ts
// Write provider interface → write-provider-types.ts
// Manifest validation → manifest-validation.ts
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

// Re-export split modules for backwards compatibility
export type { ReadActionType, WriteActionType, ActionType } from "./action-types.js";
export type {
  CampaignInfo,
  AdSetInfo,
  MetaAdsWriteProvider,
  CreateCampaignParams,
  CreateAdSetParams,
  CreateAdParams,
  CreateCustomAudienceWriteParams,
  CreateLookalikeAudienceWriteParams,
  CreateAdCreativeWriteParams,
  CreateAdStudyWriteParams,
  CreateAdRuleWriteParams,
  LeadFormInfo,
  LeadFormEntry,
  ConversionEvent,
  InsightsOptions,
} from "./write-provider-types.js";
export { validateManifest } from "./manifest-validation.js";
export type { ManifestValidationError } from "./manifest-validation.js";

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
