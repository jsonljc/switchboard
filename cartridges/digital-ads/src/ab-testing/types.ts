export type ABVariantStatus = "active" | "paused" | "winner" | "loser";

export type ABExperimentStatus = "running" | "concluded" | "cancelled";

export interface ABVariantMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  cpa?: number;
  ctr?: number;
  conversionRate?: number;
}

export interface ABVariant {
  id: string;
  experimentId: string;
  name: string;
  /** Ad set ID created for this variant */
  adSetId: string;
  /** Differentiating parameters for this variant */
  parameters: Record<string, unknown>;
  status: ABVariantStatus;
  /** Performance metrics collected during experiment */
  metrics?: ABVariantMetrics;
}

export type ABPrimaryMetric = "cpa" | "ctr" | "conversion_rate" | "roas";

export interface ABExperiment {
  id: string;
  name: string;
  /** Parent campaign ID */
  campaignId: string;
  /** Metric to optimize */
  primaryMetric: ABPrimaryMetric;
  /** Minimum sample size per variant before significance check */
  minSampleSize: number;
  /** Confidence level for significance (default: 0.95) */
  confidenceLevel: number;
  variants: ABVariant[];
  status: ABExperimentStatus;
  /** Winner variant ID, if concluded */
  winnerId: string | null;
  createdAt: string;
  concludedAt: string | null;
}
