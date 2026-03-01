import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// TikTok Lead Generation Funnel Schema
// ---------------------------------------------------------------------------
// TikTok leadgen funnel:
// Impression → Click → Lead (form submit / on-site form)
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
      metric: "onsite_form",
      metricSource: "metrics",
      costMetric: "onsite_form",
      costMetricSource: "metrics",
    },
  ],
  primaryKPI: "onsite_form",
  roasMetric: null,
};
