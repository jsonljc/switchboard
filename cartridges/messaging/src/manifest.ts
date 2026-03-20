// ---------------------------------------------------------------------------
// Messaging Cartridge — Action Manifest
// ---------------------------------------------------------------------------

import type { ActionDefinition } from "@switchboard/schemas";

export const MESSAGING_ACTIONS: ActionDefinition[] = [
  {
    actionType: "messaging.whatsapp.send",
    name: "Send WhatsApp Message",
    description: "Send a WhatsApp message to a contact.",
    parametersSchema: {
      contactId: { type: "string" },
      phoneNumber: { type: "string" },
      message: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "messaging.whatsapp.send_template",
    name: "Send WhatsApp Template Message",
    description:
      "Send a WhatsApp template message (for first-contact or 24h+ window re-engagement).",
    parametersSchema: {
      contactId: { type: "string" },
      phoneNumber: { type: "string" },
      templateName: { type: "string" },
      templateParameters: { type: "object" },
      language: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "messaging.escalation.notify_owner",
    name: "Notify Owner",
    description: "Notify the business owner via WhatsApp or Telegram about an escalation.",
    parametersSchema: {
      organizationId: { type: "string" },
      contactId: { type: "string" },
      reason: { type: "string" },
      conversationContext: { type: "string" },
      correlationId: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
];

export const MESSAGING_MANIFEST = {
  id: "messaging",
  name: "Messaging",
  version: "0.1.0",
  description:
    "Multi-channel messaging infrastructure: WhatsApp send/template, owner escalation notifications.",
  actions: MESSAGING_ACTIONS,
  requiredConnections: ["whatsapp"],
  defaultPolicies: ["messaging-opt-out-enforcement", "messaging-rate-limit"],
} satisfies import("@switchboard/schemas").CartridgeManifest;
