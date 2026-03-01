import type { FunnelSchema } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Meta Lead Generation Funnel Schema
// ---------------------------------------------------------------------------
// Primary path: Meta Instant Forms (on-platform lead capture)
//
// Impression → Click (form open) → Lead (form submit) → Qualified Lead
//
// The "qualified_lead" stage uses an offline/CAPI event that advertisers
// send back when a lead passes their qualification criteria.
// ---------------------------------------------------------------------------

export const DEFAULT_QUALIFIED_LEAD_ACTION = "offsite_conversion.fb_pixel_lead";

/**
 * Create a leadgen funnel schema with a configurable qualified lead action type.
 */
export function createLeadgenFunnel(
  qualifiedLeadAction: string = DEFAULT_QUALIFIED_LEAD_ACTION
): FunnelSchema {
  return {
    vertical: "leadgen",
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
        name: "lead",
        metric: "lead",
        metricSource: "actions",
        costMetric: "lead",
        costMetricSource: "cost_per_action_type",
      },
      {
        name: "qualified_lead",
        metric: qualifiedLeadAction,
        metricSource: "actions",
        costMetric: qualifiedLeadAction,
        costMetricSource: "cost_per_action_type",
      },
    ],
    primaryKPI: "lead",
    roasMetric: null,
  };
}

/** Default leadgen funnel (qualified lead = offsite_conversion.fb_pixel_lead) */
export const leadgenFunnel: FunnelSchema = createLeadgenFunnel();
