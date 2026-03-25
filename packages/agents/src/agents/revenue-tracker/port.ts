// ---------------------------------------------------------------------------
// Revenue Tracker — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const REVENUE_TRACKER_PORT: AgentPort = {
  agentId: "revenue-tracker",
  version: "0.2.0",
  inboundEvents: [
    "revenue.recorded",
    "stage.advanced",
    "ad.optimized",
    "opportunity.stage_advanced",
  ],
  outboundEvents: ["revenue.attributed", "conversation.escalated"],
  tools: [
    {
      name: "attribute_revenue",
      description: "Compute per-campaign revenue attribution for reporting",
      parameters: { contactId: "string", amount: "number", campaignId: "string" },
    },
    {
      name: "log_pipeline",
      description: "Log a pipeline stage transition for revenue forecasting",
      parameters: { contactId: "string", stage: "string", estimatedValue: "number" },
    },
  ],
  configSchema: {
    trackPipeline: "boolean (default: true)",
    platforms: "string[] — meta, google, tiktok (default: all connected)",
    retryOnFailure: "boolean (default: true)",
    alertOnDeadLetter: "boolean (default: true)",
  },
};
