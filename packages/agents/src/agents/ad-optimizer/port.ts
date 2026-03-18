// ---------------------------------------------------------------------------
// Ad Optimizer Agent — port declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const AD_OPTIMIZER_PORT: AgentPort = {
  agentId: "ad-optimizer",
  version: "0.1.0",
  inboundEvents: ["revenue.attributed"],
  outboundEvents: ["ad.optimized"],
  tools: [
    {
      name: "adjust_budget",
      description: "Adjust campaign budget based on ROAS data",
      parameters: { campaignId: "string", newBudget: "number" },
    },
    {
      name: "pause_campaign",
      description: "Pause an underperforming campaign",
      parameters: { campaignId: "string" },
    },
  ],
  configSchema: {
    targetROAS: "number (default: 4.0)",
    maxBudgetChangePercent: "number (default: 20)",
    minDataDays: "number (default: 7)",
  },
};
