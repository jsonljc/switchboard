// ---------------------------------------------------------------------------
// Ad Optimizer — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const AD_OPTIMIZER_PORT: AgentPort = {
  agentId: "ad-optimizer",
  version: "0.3.0",
  inboundEvents: [
    "revenue.attributed",
    "ad.anomaly_detected",
    "ad.performance_review",
    "opportunity.stage_advanced",
  ],
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
    anomalyThreshold: "number (% drop to trigger pause, default: 30)",
    reviewInterval: "string (default: 5 min)",
    approvalThreshold: "number (dollar amount above which changes need owner approval)",
    platforms: "string[] — meta, google, tiktok (default: all connected)",
    targetROAS: "number (ROAS target for budget increase triggers, default: 2.0)",
    alertChannel: "whatsapp | telegram (default: whatsapp)",
  },
};
