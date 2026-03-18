// ---------------------------------------------------------------------------
// Ad Optimizer — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const AD_OPTIMIZER_PORT: AgentPort = {
  agentId: "ad-optimizer",
  version: "0.1.0",
  inboundEvents: ["revenue.recorded", "stage.advanced"],
  outboundEvents: ["ad.optimized", "conversation.escalated"],
  tools: [
    {
      name: "send_conversion",
      description: "Send a conversion event to an ad platform (Meta CAPI, Google, TikTok)",
      parameters: {
        platform: "meta | google | tiktok",
        eventName: "string (e.g. Purchase, Lead, CompleteRegistration)",
        contactId: "string",
        value: "number (revenue amount)",
        currency: "string (default: USD)",
      },
    },
    {
      name: "diagnose_funnel",
      description: "Run funnel diagnostics across connected ad platforms",
      parameters: {
        platform: "meta | google | tiktok | all",
        lookbackDays: "number (default: 7)",
      },
    },
  ],
  configSchema: {
    connectedPlatforms: "string[] (platforms to send conversions to)",
    defaultCurrency: "string (default: USD)",
    conversionEventMap: "Record<string, string> (stage -> platform event name mapping)",
  },
};
