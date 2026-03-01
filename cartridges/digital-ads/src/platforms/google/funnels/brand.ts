import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Google Ads Brand Funnel Schema
// ---------------------------------------------------------------------------
// Google brand campaigns (primarily YouTube) focus on video views and reach.
// The journey is:
// Impressions → Views (video_views) → View Rate → Earned Actions
//
// Primary KPI: cost per video view
// ---------------------------------------------------------------------------

export const brandFunnel: FunnelSchema = {
  vertical: "brand",
  stages: [
    {
      name: "awareness",
      metric: "impressions",
      metricSource: "metrics",
      costMetric: "cpm",
      costMetricSource: "metrics",
    },
    {
      name: "view",
      metric: "video_views",
      metricSource: "metrics",
      costMetric: "video_views",
      costMetricSource: "metrics",
    },
    {
      name: "engagement",
      metric: "clicks",
      metricSource: "metrics",
      costMetric: "cpc",
      costMetricSource: "metrics",
    },
  ],
  primaryKPI: "video_views",
  roasMetric: null,
};
