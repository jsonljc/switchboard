export interface LiftStudy {
  id: string;
  name: string;
  status: string;
  type: string;
  startTime: string | null;
  endTime: string | null;
  results: {
    confidenceLevel: number | null;
    incrementalConversions: number | null;
    incrementalCostPerConversion: number | null;
    liftPercent: number | null;
  } | null;
}

export interface AttributionComparison {
  metric: string;
  windows: Array<{
    window: string;
    conversions: number;
    costPerConversion: number | null;
  }>;
}

export interface MMMExportData {
  dateRange: { since: string; until: string };
  dailyData: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  format: "csv" | "json";
}
