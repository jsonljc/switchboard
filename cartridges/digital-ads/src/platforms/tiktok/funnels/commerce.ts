import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// TikTok Commerce Funnel Schema
// ---------------------------------------------------------------------------
// TikTok's e-commerce journey (similar to Meta but no LPV):
// Impression → Click → View Content (page_browse) → Add to Cart → Purchase
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
      name: "view_content",
      metric: "page_browse",
      metricSource: "metrics",
      costMetric: null,
      costMetricSource: null,
    },
    {
      name: "add_to_cart",
      metric: "onsite_add_to_cart",
      metricSource: "metrics",
      costMetric: "onsite_add_to_cart",
      costMetricSource: "metrics",
    },
    {
      name: "purchase",
      metric: "complete_payment",
      metricSource: "metrics",
      costMetric: "complete_payment",
      costMetricSource: "metrics",
    },
  ],
  primaryKPI: "complete_payment",
  roasMetric: "complete_payment_roas",
};
