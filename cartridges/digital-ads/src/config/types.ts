import type { EntityLevel, VerticalType } from "../core/types.js";
import type { PlatformCredentials, PlatformType } from "../platforms/types.js";

// ---------------------------------------------------------------------------
// Multi-Platform Account Configuration
// ---------------------------------------------------------------------------

/** Configuration for a single platform within an account */
export interface PlatformAccountConfig {
  platform: PlatformType;
  /** Whether to include this platform in diagnostics (default: true) */
  enabled?: boolean;
  /** Platform credentials */
  credentials: PlatformCredentials;
  /** The ad account or entity ID for this platform */
  entityId: string;
  /** Entity level (default: "account") */
  entityLevel?: EntityLevel;
  /** For Meta leadgen: custom qualified lead action type */
  qualifiedLeadActionType?: string;
  /** Enable structural analysis (sub-entity breakdowns) */
  enableStructuralAnalysis?: boolean;
  /** Enable historical trend analysis for creative exhaustion detection */
  enableHistoricalTrends?: boolean;
  /** Number of trailing periods for historical analysis (default: 4) */
  historicalPeriods?: number;
  /** Target ROAS for efficiency comparison (e.g. 4.0 = $4 revenue per $1 spent) */
  targetROAS?: number;
}

/** Top-level account configuration for multi-platform diagnostics */
export interface AccountConfig {
  /** Human-readable account name */
  name: string;
  /** Vertical for all platforms in this account */
  vertical: VerticalType;
  /** Per-platform configurations */
  platforms: PlatformAccountConfig[];
  /** Number of days per comparison period (default: 7 = WoW) */
  periodDays?: number;
  /** Reference date for "current" period end (default: yesterday) */
  referenceDate?: string;
}

/** Raw JSON config format (credentials reference env vars) */
export interface RawAccountConfig {
  name: string;
  vertical: VerticalType;
  platforms: Array<{
    platform: PlatformType;
    enabled?: boolean;
    entityId: string;
    entityLevel?: EntityLevel;
    qualifiedLeadActionType?: string;
    enableStructuralAnalysis?: boolean;
    enableHistoricalTrends?: boolean;
    historicalPeriods?: number;
    credentials: Record<string, string>;
  }>;
  periodDays?: number;
  referenceDate?: string;
}
