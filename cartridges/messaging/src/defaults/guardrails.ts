// ---------------------------------------------------------------------------
// Default Guardrails — Messaging
// ---------------------------------------------------------------------------

import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_MESSAGING_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "patient",
      maxActions: 10,
      windowMs: 86_400_000,
    },
    {
      scope: "global",
      maxActions: 1000,
      windowMs: 86_400_000,
    },
  ],
  cooldowns: [
    {
      actionType: "messaging.whatsapp.send_template",
      cooldownMs: 86_400_000,
      scope: "patient",
    },
    {
      actionType: "messaging.escalation.notify_owner",
      cooldownMs: 300_000,
      scope: "global",
    },
  ],
  protectedEntities: [],
};
