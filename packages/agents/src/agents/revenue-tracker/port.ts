// ---------------------------------------------------------------------------
// Revenue Tracker — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const REVENUE_TRACKER_PORT: AgentPort = {
  agentId: "revenue-tracker",
  version: "0.1.0",
  inboundEvents: ["revenue.recorded", "stage.advanced"],
  outboundEvents: ["revenue.attributed", "conversation.escalated"],
  tools: [
    {
      name: "attribute_revenue",
      description: "Compute per-campaign revenue attribution for reporting",
      parameters: {
        contactId: "string",
        amount: "number",
        campaignId: "string",
      },
    },
    {
      name: "log_pipeline",
      description: "Log a pipeline stage transition for revenue forecasting",
      parameters: {
        contactId: "string",
        stage: "string",
        estimatedValue: "number",
      },
    },
  ],
  configSchema: {
    attributionModel: "last_click | linear | time_decay (default: last_click)",
    attributionWindowDays: "number (default: 28)",
    trackPipeline: "boolean (default: true)",
  },
};
