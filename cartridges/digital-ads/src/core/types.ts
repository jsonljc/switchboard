// ---------------------------------------------------------------------------
// Funnel Schema — defines the shape of a vertical's funnel
// ---------------------------------------------------------------------------

export interface FunnelStage {
  /** Human-readable name shown in diagnostics */
  name: string;
  /** The Meta actions[] action_type, or a top-level field like 'impressions' */
  metric: string;
  /** Where to find this metric in the API response (e.g. "actions", "top_level", "metrics") */
  metricSource: string;
  /** The cost metric for this stage (null if not directly billable) */
  costMetric: string | null;
  /** Where to find the cost metric */
  costMetricSource: string | null;
}

export interface FunnelSchema {
  vertical: VerticalType;
  stages: FunnelStage[];
  /** The primary KPI action_type (e.g. 'purchase', 'lead') */
  primaryKPI: string;
  /** ROAS metric if applicable */
  roasMetric: string | null;
}

// ---------------------------------------------------------------------------
// Verticals
// ---------------------------------------------------------------------------

export type VerticalType = "commerce" | "leadgen" | "brand";

// ---------------------------------------------------------------------------
// Metric data — normalized output from the API fetch layer
// ---------------------------------------------------------------------------

export interface StageMetrics {
  count: number;
  cost: number | null;
}

/** A single time-period snapshot of all funnel metrics for an entity */
export interface MetricSnapshot {
  /** The ad account, campaign, or adset ID */
  entityId: string;
  entityLevel: EntityLevel;
  /** ISO date string for period start */
  periodStart: string;
  /** ISO date string for period end */
  periodEnd: string;
  /** Total spend in this period */
  spend: number;
  /** Metrics keyed by the FunnelStage.metric value */
  stages: Record<string, StageMetrics>;
  /** Raw top-level fields (ctr, cpm, cpc, etc.) */
  topLevel: Record<string, number>;
}

export type EntityLevel = "account" | "campaign" | "adset" | "ad";

// ---------------------------------------------------------------------------
// Time ranges
// ---------------------------------------------------------------------------

export interface TimeRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export interface ComparisonPeriods {
  current: TimeRange;
  previous: TimeRange;
}

// ---------------------------------------------------------------------------
// Sub-entity and diagnostic context
// ---------------------------------------------------------------------------

export interface SubEntityBreakdown {
  entityId: string;
  entityLevel: EntityLevel;
  spend: number;
  conversions: number;
  daysSinceLastEdit: number | null;
  inLearningPhase: boolean;
  /** Daily budget allocated to this entity (null if not available or using lifetime budget) */
  dailyBudget: number | null;
}

/** Breakdown of performance by placement */
export interface PlacementBreakdown {
  placement: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpa: number | null;
  cpm: number | null;
}

/** Breakdown of ad-level performance within an ad set */
export interface AdBreakdown {
  adId: string;
  adSetId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpa: number | null;
  ctr: number | null;
  /** Ad format (image, video, carousel, etc.) */
  format: string | null;
}

/** Daily performance snapshot for intra-week analysis */
export interface DailyBreakdown {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

/** Audience overlap between two ad sets */
export interface AudienceOverlapPair {
  adSetId1: string;
  adSetId2: string;
  /** Overlap percentage (0-1) */
  overlapRate: number;
}

/** Device-level performance breakdown */
export interface DeviceBreakdown {
  device: string; // "mobile" | "desktop" | "tablet" | "other"
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpa: number | null;
  cpm: number | null;
}

export interface DiagnosticContext {
  subEntities?: SubEntityBreakdown[];
  historicalSnapshots?: MetricSnapshot[];
  revenueData?: {
    averageOrderValue: number;
    totalRevenue: number;
    previousTotalRevenue: number;
  };
  /** Placement-level breakdown for the current period */
  placementBreakdowns?: PlacementBreakdown[];
  /** Ad-level breakdowns grouped by ad set */
  adBreakdowns?: AdBreakdown[];
  /** Daily performance breakdowns for the current period */
  dailyBreakdowns?: DailyBreakdown[];
  /** Daily performance breakdowns for the previous period */
  previousDailyBreakdowns?: DailyBreakdown[];
  /** Audience overlap data between ad sets (Meta-only, from delivery estimate API) */
  audienceOverlaps?: AudienceOverlapPair[];
  /** Device-level performance breakdowns */
  deviceBreakdowns?: DeviceBreakdown[];
  /** Attribution window used in the current period (days) */
  attributionWindow?: number;
  /** Attribution window used in the previous period (days) */
  previousAttributionWindow?: number;
}

export interface EconomicImpact {
  estimatedRevenueDelta: number;
  conversionDelta: number;
  revenueImpactPercent: number;
}

// ---------------------------------------------------------------------------
// Diagnostic output
// ---------------------------------------------------------------------------

export type Severity = "critical" | "warning" | "info" | "healthy";

export interface StageDiagnostic {
  stageName: string;
  metric: string;
  currentValue: number;
  previousValue: number;
  /** Absolute change */
  delta: number;
  /** Percentage change (positive = increase) */
  deltaPercent: number;
  /** Whether this change is statistically meaningful given spend */
  isSignificant: boolean;
  severity: Severity;
  /** Dollar-denominated impact estimate when revenue data is available */
  economicImpact?: EconomicImpact;
}

export interface FunnelDropoff {
  fromStage: string;
  toStage: string;
  currentRate: number;
  previousRate: number;
  deltaPercent: number;
  /** Dollar-denominated impact estimate when revenue data is available */
  economicImpact?: EconomicImpact;
}

export interface DiagnosticResult {
  vertical: VerticalType;
  entityId: string;
  /** Platform that generated this result (e.g. "meta", "google", "tiktok") */
  platform?: string;
  periods: ComparisonPeriods;
  spend: { current: number; previous: number };
  /** Primary KPI summary */
  primaryKPI: {
    name: string;
    current: number;
    previous: number;
    deltaPercent: number;
    severity: Severity;
  };
  /** Per-stage WoW comparison */
  stageAnalysis: StageDiagnostic[];
  /** Drop-off rates between adjacent stages */
  dropoffs: FunnelDropoff[];
  /** The stage with the most significant negative change */
  bottleneck: StageDiagnostic | null;
  /** Human-readable diagnosis strings */
  findings: Finding[];
  /** Funnel elasticity ranking — dollar impact per stage */
  elasticity?: {
    totalEstimatedRevenueLoss: number;
    impactRanking: Array<{ stage: string; estimatedRevenueDelta: number; severity: Severity }>;
  };
}

export interface Finding {
  severity: Severity;
  stage: string;
  message: string;
  recommendation: string | null;
}

// ---------------------------------------------------------------------------
// Vertical benchmarks — fallback thresholds for new accounts
// ---------------------------------------------------------------------------

export interface StageBenchmark {
  /** Expected drop-off rate from the stage above (e.g. 0.03 = 3% of clicks become ATC) */
  expectedDropoffRate: number;
  /** How much WoW variance is normal before flagging */
  normalVariancePercent: number;
}

export interface VerticalBenchmarks {
  vertical: VerticalType;
  benchmarks: Record<string, StageBenchmark>;
}
