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

export type CampaignStage = "hot" | "warm" | "cool";

export interface CampaignRow {
  name: string;
  stage: CampaignStage;
  spend: number;
  leads: number;
  revenue: number;
  roas: number;
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
