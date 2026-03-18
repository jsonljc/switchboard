// ---------------------------------------------------------------------------
// Revenue Tracker — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const REVENUE_TRACKER_PORT: AgentPort = {
  agentId: "revenue-tracker",
  version: "0.1.0",
  inboundEvents: ["revenue.recorded", "stage.advanced", "ad.optimized"],
  outboundEvents: ["revenue.attributed"],
  tools: [
    {
      name: "attribute_revenue",
      description: "Compute per-campaign revenue attribution",
      parameters: { organizationId: "string" },
    },
    {
      name: "send_conversion",
      description: "Send offline conversion to ad platform",
      parameters: { platform: "string", conversionData: "object" },
    },
  ],
  configSchema: {
    attributionWindow: "number (default: 28 days)",
    attributionModel: "last_click | linear | time_decay (default: last_click)",
    enabledPlatforms: "string[] (default: ['meta'])",
  },
};
