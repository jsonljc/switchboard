// ---------------------------------------------------------------------------
// Nurture Agent — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const NURTURE_AGENT_PORT: AgentPort = {
  agentId: "nurture",
  version: "0.1.0",
  inboundEvents: ["lead.disqualified", "stage.advanced", "revenue.recorded"],
  outboundEvents: ["stage.advanced", "lead.qualified"],
  tools: [
    {
      name: "start_cadence",
      description: "Start a multi-step follow-up cadence for a contact",
      parameters: { contactId: "string", cadenceType: "string" },
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
    coldNurtureCadenceId: "string",
    postServiceCadenceId: "string",
    reactivationDays: "number (default: 30)",
    reviewRequestDelay: "number (default: 24h)",
  },
};
