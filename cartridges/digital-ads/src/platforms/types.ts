import type {
  EntityLevel,
  FunnelSchema,
  MetricSnapshot,
  SubEntityBreakdown,
  TimeRange,
  VerticalBenchmarks,
} from "../core/types.js";
import type { FindingAdvisor } from "../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Platform types
// ---------------------------------------------------------------------------

export type PlatformType = "meta" | "google" | "tiktok";

// ---------------------------------------------------------------------------
// Platform client interface
// ---------------------------------------------------------------------------

export interface PlatformClient {
  readonly platform: PlatformType;

  fetchSnapshot(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema,
  ): Promise<MetricSnapshot>;

  fetchComparisonSnapshots(
    entityId: string,
    entityLevel: EntityLevel,
    current: TimeRange,
    previous: TimeRange,
    funnel: FunnelSchema,
  ): Promise<{ current: MetricSnapshot; previous: MetricSnapshot }>;

  /** Optional: fetch sub-entity (ad set / ad group) breakdowns for structural analysis */
  fetchSubEntityBreakdowns?(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema,
  ): Promise<SubEntityBreakdown[]>;
}

// ---------------------------------------------------------------------------
// Platform credentials — discriminated union
// ---------------------------------------------------------------------------

export interface MetaCredentials {
  platform: "meta";
  accessToken: string;
}

export interface GoogleCredentials {
  platform: "google";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  /** Optional: login customer ID for MCC accounts */
  loginCustomerId?: string;
}

export interface TikTokCredentials {
  platform: "tiktok";
  accessToken: string;
  /** App ID from TikTok Developer portal */
  appId: string;
}

export type PlatformCredentials = MetaCredentials | GoogleCredentials | TikTokCredentials;

// ---------------------------------------------------------------------------
// Platform diagnostic config — bundles everything for one platform run
// ---------------------------------------------------------------------------

export interface PlatformDiagnosticConfig {
  platform: PlatformType;
  client: PlatformClient;
  funnel: FunnelSchema;
  benchmarks: VerticalBenchmarks;
  advisors: FindingAdvisor[];
  entityId: string;
  entityLevel: EntityLevel;
}
