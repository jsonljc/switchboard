import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Meta Brand Funnel Schema
// ---------------------------------------------------------------------------
// Brand campaigns optimize for reach, frequency, and video engagement
// rather than conversions. The journey is:
// Impressions → Reach → ThruPlay → Ad Recall Lift
//
// Primary KPI: cost per ThruPlay (video view to completion or 15 seconds)
// ---------------------------------------------------------------------------

export const brandFunnel: FunnelSchema = {
  vertical: "brand",
  stages: [
    {
      name: "awareness",
      metric: "impressions",
      metricSource: "top_level",
      costMetric: "cpm",
      costMetricSource: "top_level",
    },
    {
      name: "reach",
      metric: "reach",
      metricSource: "top_level",
      costMetric: null,
      costMetricSource: null,
    },
    {
      name: "thruplay",
      metric: "video_thruplay_actions",
      metricSource: "actions",
      costMetric: "video_thruplay_actions",
      costMetricSource: "cost_per_action_type",
    },
    {
      name: "ad_recall",
      metric: "estimated_ad_recall_lift",
      metricSource: "top_level",
      costMetric: null,
      costMetricSource: null,
    },
  ],
  primaryKPI: "video_thruplay_actions",
  roasMetric: null,
};
