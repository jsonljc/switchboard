// ---------------------------------------------------------------------------
// Reporting Types
// ---------------------------------------------------------------------------

export type ReportDatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_28d"
  | "last_30d"
  | "last_90d"
  | "this_month"
  | "last_month";

export type ReportBreakdown =
  | "age"
  | "gender"
  | "country"
  | "region"
  | "publisher_platform"
  | "platform_position"
  | "device_platform"
  | "impression_device";

export type ReportLevel = "account" | "campaign" | "adset" | "ad";

export interface ReportTimeRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export interface GenerateReportParams {
  adAccountId: string;
  datePreset?: ReportDatePreset;
  timeRange?: ReportTimeRange;
  level?: ReportLevel;
  breakdowns?: ReportBreakdown[];
  fields?: string[];
  filtering?: Array<{ field: string; operator: string; value: unknown }>;
  limit?: number;
}

export interface CreativeReportParams {
  adAccountId: string;
  datePreset?: ReportDatePreset;
  timeRange?: ReportTimeRange;
  limit?: number;
}

export interface AudienceReportParams {
  adAccountId: string;
  datePreset?: ReportDatePreset;
  timeRange?: ReportTimeRange;
}

export interface PlacementReportParams {
  adAccountId: string;
  datePreset?: ReportDatePreset;
  timeRange?: ReportTimeRange;
}

export interface ComparisonReportParams {
  adAccountId: string;
  currentPeriod: ReportTimeRange;
  previousPeriod: ReportTimeRange;
  level?: ReportLevel;
  metrics?: string[];
}

export interface ReportRow {
  [key: string]: unknown;
}

export interface PerformanceReport {
  rows: ReportRow[];
  summary: {
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    totalConversions: number;
    avgCTR: number;
    avgCPM: number;
    avgCPC: number;
  };
  dateRange: ReportTimeRange;
  level: ReportLevel;
  breakdowns: ReportBreakdown[];
}

export interface CreativeReport {
  creatives: Array<{
    adId: string;
    adName: string;
    creativeId: string;
    thumbnailUrl: string | null;
    format: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpc: number;
    cpa: number | null;
  }>;
  dateRange: ReportTimeRange;
}

export interface AudienceReport {
  ageGender: Array<{
    age: string;
    gender: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpa: number | null;
  }>;
  countries: Array<{
    country: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpa: number | null;
  }>;
  dateRange: ReportTimeRange;
}

export interface PlacementReport {
  placements: Array<{
    platform: string;
    position: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpm: number;
    cpa: number | null;
  }>;
  dateRange: ReportTimeRange;
}

export interface ComparisonReport {
  current: ReportRow[];
  previous: ReportRow[];
  changes: Array<{
    metric: string;
    currentValue: number;
    previousValue: number;
    absoluteChange: number;
    percentChange: number;
  }>;
  currentPeriod: ReportTimeRange;
  previousPeriod: ReportTimeRange;
}
