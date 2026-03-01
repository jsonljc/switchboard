import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// TikTok Brand Funnel Schema
// ---------------------------------------------------------------------------
// TikTok brand campaigns optimize for reach and video engagement.
// The journey is:
// Impressions → Reach → Video Views (6s/15s) → Engagement (clicks/shares)
//
// Primary KPI: cost per video view (6-second focused views)
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
      name: "reach",
      metric: "reach",
      metricSource: "metrics",
      costMetric: null,
      costMetricSource: null,
    },
    {
      name: "video_view",
      metric: "video_views_p50",
      metricSource: "metrics",
      costMetric: "video_views_p50",
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
  primaryKPI: "video_views_p50",
  roasMetric: null,
};
