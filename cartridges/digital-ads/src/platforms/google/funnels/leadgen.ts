import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Google Ads Lead Generation Funnel Schema
// ---------------------------------------------------------------------------
// Google Ads leadgen funnel:
// Impression → Click → Lead (conversion action)
// ---------------------------------------------------------------------------

export const leadgenFunnel: FunnelSchema = {
  vertical: "leadgen",
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
      name: "lead",
      metric: "conversions",
      metricSource: "conversion_action",
      costMetric: "cost_per_conversion",
      costMetricSource: "metrics",
    },
  ],
  primaryKPI: "conversions",
  roasMetric: null,
};
