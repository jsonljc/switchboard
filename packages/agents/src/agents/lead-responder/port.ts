// ---------------------------------------------------------------------------
// Lead Responder — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const LEAD_RESPONDER_PORT: AgentPort = {
  agentId: "lead-responder",
  version: "0.1.0",
  inboundEvents: ["lead.received", "message.received"],
  outboundEvents: ["lead.qualified", "lead.disqualified", "conversation.escalated"],
  tools: [
    {
      name: "qualify_lead",
      description: "Score and qualify an inbound lead based on engagement signals",
      parameters: {
        contactId: "string",
        serviceValue: "number",
        urgencyLevel: "number (0-10)",
        source: "referral | organic | paid | walk_in | other",
        engagementScore: "number (0-10)",
        budgetIndicator: "number (0-10)",
      },
    },
    {
      name: "handle_objection",
      description: "Match an objection against known responses and provide a reply",
      parameters: {
        contactId: "string",
        objectionText: "string",
      },
    },
  ],
  configSchema: {
    qualificationThreshold: "number (default: 40)",
    maxTurnsBeforeEscalation: "number (default: 10)",
    tonePreset: "warm-professional | casual-conversational | direct-efficient (default: warm-professional)",
    language: "en | ms | zh | en-sg (default: en)",
    confidenceThreshold: "number 0-1 (default: 0.6)",
    bookingLink: "string (optional)",
    mode: "active | draft | test (default: active)",
  },
};
