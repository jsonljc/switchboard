/**
 * /reports backend v1 — locked view-model.
 *
 * Single source of truth for the shape of ReportDataV1, consumed by the
 * dashboard /reports page and produced by core's period-rollup.
 *
 * v1 invariants:
 *   - 3 windows: THIS WEEK, THIS MONTH, THIS QUARTER (spaces, not
 *     underscores — preserved for back-compat with the static page).
 *   - Funnel has 6 stages; "Landing visits" may be hidden client-side
 *     when no pixel data exists, but the row stays in the array.
 *   - managedComparison is null when neither in-period cohort nor
 *     baseline data exists.
 */

export type ReportWindow = "THIS WEEK" | "THIS MONTH" | "THIS QUARTER";

export const REPORT_WINDOWS: readonly ReportWindow[] = [
  "THIS WEEK",
  "THIS MONTH",
  "THIS QUARTER",
] as const;

export const DEFAULT_REPORT_WINDOW: ReportWindow = "THIS MONTH";

export type DeltaKind = "pos" | "flat" | "neg";

export interface Delta {
  kind: DeltaKind;
  text: string;
}

export interface PullQuoteCopy {
  pre: string;
  value: string;
  mid: string;
  cost: string;
  post: string;
}

export interface AttributionCell {
  value: number;
  caption: string;
}

export interface AttributionData {
  total: number;
  delta: Delta;
  riley: AttributionCell;
  alex: AttributionCell;
}

export interface FunnelRowData {
  stage: string;
  n: number;
  label: string;
  delta: Delta | null;
}

export interface FunnelNarrative {
  marker: string;
  text: string;
}

export interface CampaignRow {
  name: string;
  spend: number;
  impressions: number;
  inlineLinkClicks: number;
  costPerInlineLinkClick: number;
  inlineLinkClickCtr: number;
  leads: number;
  revenue: number;
  cpl: number | null;
  clickToLeadRate: number | null;
  roas: number;
}

export interface ReportCampaignInsight {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  inlineLinkClicks: number;
  costPerInlineLinkClick: number;
  inlineLinkClickCtr: number;
  conversions: number;
}

export interface CostBreakdown {
  paid: number;
  alt: number;
  saving: number;
}

export interface ManagedComparisonMetrics {
  spend: number;
  revenue?: number;
  roas?: number;
  replies?: number;
  conversionRate?: number;
  replyMinutesP50?: number;
}

export interface ManagedComparisonPair {
  managed: ManagedComparisonMetrics;
  unmanaged: ManagedComparisonMetrics;
  delta: Delta;
}

export type ManagedComparisonSource = "in-period-cohort" | "pre-switchboard-baseline";

export interface ManagedComparisonData {
  ads: ManagedComparisonPair | null;
  conversations: ManagedComparisonPair | null;
  source: ManagedComparisonSource;
  emptyMessage?: string;
}

export interface ReportDataV1 {
  label: ReportWindow;
  period: string;
  dateFolio: string;
  pullquote: PullQuoteCopy;
  attribution: AttributionData;
  funnel: FunnelRowData[];
  funnelNarrative: FunnelNarrative;
  campaigns: CampaignRow[];
  cost: CostBreakdown;
  costNarrative: string;
  managedComparison: ManagedComparisonData | null;
}

// ---------------------------------------------------------------------------
// Report insights provider — injected into core from ad-optimizer via apps/api
// ---------------------------------------------------------------------------

export interface ReportInsightsMetrics {
  impressions: number;
  inlineLinkClicks: number;
  landingPageViews: number;
  spend: number;
}

export interface ReportInsightsProvider {
  getAggregateMetrics(dateRange: { since: string; until: string }): Promise<ReportInsightsMetrics>;
  getCampaignMetrics(dateRange: { since: string; until: string }): Promise<ReportCampaignInsight[]>;
}
