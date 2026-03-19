// ---------------------------------------------------------------------------
// Nurture Agent — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const NURTURE_AGENT_PORT: AgentPort = {
  agentId: "nurture",
  version: "0.1.0",
  inboundEvents: ["stage.advanced"],
  outboundEvents: ["conversation.escalated"],
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
    enabledCadences: "string[] (cadence IDs to activate, default: all)",
    reviewDelayDays: "number (days after service to request review, default: 7)",
    maxConcurrentCadences: "number (max cadences per contact, default: 2)",
  },
};
