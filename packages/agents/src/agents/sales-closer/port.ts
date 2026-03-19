// ---------------------------------------------------------------------------
// Sales Closer — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const SALES_CLOSER_PORT: AgentPort = {
  agentId: "sales-closer",
  version: "0.1.0",
  inboundEvents: ["lead.qualified"],
  outboundEvents: ["stage.advanced", "revenue.recorded", "conversation.escalated"],
  tools: [
    {
      name: "book_appointment",
      description: "Book an appointment for a qualified lead via calendar provider",
      parameters: {
        contactId: "string",
        serviceType: "string",
        startTime: "ISO 8601 datetime",
        durationMinutes: "number (default: 60)",
      },
    },
    {
      name: "send_booking_link",
      description: "Send a self-service booking link to the lead",
      parameters: {
        contactId: "string",
        serviceType: "string",
      },
    },
  ],
  configSchema: {
    defaultServiceType: "string (default: consultation)",
    defaultDurationMinutes: "number (default: 60)",
    maxFollowUpAttempts: "number (default: 3)",
  },
  conversionActionTypes: ["booking", "checkout_link"],
};
