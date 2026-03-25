// ---------------------------------------------------------------------------
// Nurture Agent — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const NURTURE_AGENT_PORT: AgentPort = {
  agentId: "nurture",
  version: "0.2.0",
  inboundEvents: [
    "stage.advanced",
    "lead.disqualified",
    "revenue.recorded",
    "opportunity.stage_advanced",
  ],
  outboundEvents: ["lead.qualified", "conversation.escalated", "opportunity.stage_advanced"],
  tools: [
    {
      name: "start_cadence",
      description: "Start a multi-step follow-up cadence for a contact",
      parameters: { contactId: "string", cadenceId: "string" },
    },
    {
      name: "send_reminder",
      description: "Send a reminder to a contact",
      parameters: { contactId: "string", message: "string" },
    },
    {
      name: "request_review",
      description: "Send a review solicitation after completed service",
      parameters: { contactId: "string", platform: "string" },
    },
  ],
  configSchema: {
    activeCadences:
      "string[] (default: all — consultation-reminder, no-show-recovery, post-treatment-review, cold-lead-winback, dormant-client)",
    dormantThresholdDays: "number (default: 60)",
    reviewPlatformLink: "string (Google Maps URL or Facebook review link)",
    reviewDelayDays: "number (default: 7)",
    requalify: "boolean (default: false)",
    tonePreset: "warm-professional | casual-conversational | direct-efficient (default: inherits)",
    language: "en | ms | zh | en-sg (default: inherits)",
  },
};
