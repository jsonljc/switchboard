import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Google Ads Commerce Funnel Schema
// ---------------------------------------------------------------------------
// Google Ads has a simpler funnel than Meta — no landing page view or
// view_content breakdown in standard reporting. The journey is:
// Impression → Click → Conversion (purchase)
// ---------------------------------------------------------------------------

export const commerceFunnel: FunnelSchema = {
  vertical: "commerce",
  stages: [
    {
      name: "awareness",
      metric: "impressions",
      metricSource: "metrics",
      costMetric: "cpm",
      costMetricSource: "metrics",
    },
    {
      name: "click",
      metric: "clicks",
      metricSource: "metrics",
      costMetric: "cpc",
      costMetricSource: "metrics",
    },
    {
      name: "conversion",
      metric: "conversions",
      metricSource: "metrics",
      costMetric: "cost_per_conversion",
      costMetricSource: "metrics",
    },
  ],
  primaryKPI: "conversions",
  roasMetric: "roas",
};
