// Shared types for the Results screen. Re-export the locked ReportDataV1
// sub-types so components import from one place (and never redefine shapes).
export type {
  ReportDataV1 as ReportData,
  ReportWindow,
  Delta,
  PullQuoteCopy,
  AttributionData,
  AttributionCell,
  FunnelRowData,
  FunnelNarrative,
  CampaignRow,
  CostBreakdown,
  HeldRateData,
  ConsentCompletenessData,
  ManagedComparisonData,
  ManagedComparisonPair,
  ManagedComparisonMetrics,
  ManagedComparisonSource,
} from "@switchboard/schemas";
