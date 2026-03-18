// ---------------------------------------------------------------------------
// Lead Responder — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const LEAD_RESPONDER_PORT: AgentPort = {
  agentId: "lead-responder",
  version: "0.1.0",
  inboundEvents: ["lead.received"],
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
    autoQualify: "boolean (default: true)",
    maxTurnsBeforeEscalation: "number (default: 10)",
  },
};
