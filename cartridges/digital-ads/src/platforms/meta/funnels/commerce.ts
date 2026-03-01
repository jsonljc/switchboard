import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Meta Commerce Funnel Schema
// ---------------------------------------------------------------------------
// The standard e-commerce journey on Meta:
// Impression → Link Click → Landing Page View → View Content → Add to Cart → Purchase
// ---------------------------------------------------------------------------

export const commerceFunnel: FunnelSchema = {
  vertical: "commerce",
  stages: [
    {
      name: "awareness",
      metric: "impressions",
      metricSource: "top_level",
      costMetric: "cpm",
      costMetricSource: "top_level",
    },
    {
      name: "click",
      metric: "inline_link_clicks",
      metricSource: "top_level",
      costMetric: "cpc",
      costMetricSource: "top_level",
    },
    {
      name: "landing_page",
      metric: "landing_page_view",
      metricSource: "actions",
      costMetric: null,
      costMetricSource: null,
    },
    {
      name: "view_content",
      metric: "view_content",
      metricSource: "actions",
      costMetric: null,
      costMetricSource: null,
    },
    {
      name: "add_to_cart",
      metric: "add_to_cart",
      metricSource: "actions",
      costMetric: "add_to_cart",
      costMetricSource: "cost_per_action_type",
    },
    {
      name: "purchase",
      metric: "purchase",
      metricSource: "actions",
      costMetric: "purchase",
      costMetricSource: "cost_per_action_type",
    },
  ],
  primaryKPI: "purchase",
  roasMetric: "website_purchase_roas",
};
