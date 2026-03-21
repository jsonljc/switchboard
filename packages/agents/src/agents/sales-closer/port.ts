// ---------------------------------------------------------------------------
// Sales Closer — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const SALES_CLOSER_PORT: AgentPort = {
  agentId: "sales-closer",
  version: "0.1.0",
  inboundEvents: ["lead.qualified", "message.received"],
  outboundEvents: ["stage.advanced", "conversation.escalated"],
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
    confidenceThreshold: "number 0-1 (default: 0.6)",
    maxTurnsBeforeEscalation: "number (default: 10)",
    tonePreset:
      "warm-professional | casual-conversational | direct-efficient (default: warm-professional)",
    language: "en | ms | zh | en-sg (default: en)",
    bookingUrl: "string (optional — overrides profile.booking.bookingUrl)",
    urgencyEnabled: "boolean (default: true)",
    followUpDays: "number[] (default: [1, 3, 7])",
    mode: "active | draft | test (default: active)",
  },
  conversionActionTypes: ["booking", "checkout_link"],
};
