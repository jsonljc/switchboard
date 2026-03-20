// ---------------------------------------------------------------------------
// Ad Optimizer — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const AD_OPTIMIZER_PORT: AgentPort = {
  agentId: "ad-optimizer",
  version: "0.2.0",
  inboundEvents: ["revenue.attributed", "ad.anomaly_detected", "ad.performance_review"],
  outboundEvents: ["ad.optimized", "conversation.escalated"],
  tools: [
    {
      name: "analyze_budget",
      description: "Analyze ad budget allocation across platforms and campaigns",
      parameters: {
        platform: "meta | google | tiktok | all",
        lookbackDays: "number (default: 7)",
      },
    },
    {
      name: "adjust_budget",
      description: "Recommend budget adjustment for a campaign",
      parameters: {
        campaignId: "string",
        platform: "string",
        adjustment: "increase | decrease | pause",
        reason: "string",
      },
    },
  ],
  configSchema: {
    connectedPlatforms: "string[] (platforms to optimize)",
    budgetThresholds: "Record<string, number> (campaign spend limits)",
    anomalyThreshold: "number (ROAS drop % to trigger alert, default: 30)",
  },
};
