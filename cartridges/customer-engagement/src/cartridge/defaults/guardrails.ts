// ---------------------------------------------------------------------------
// Default Guardrails — Customer Engagement
// ---------------------------------------------------------------------------

import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_CUSTOMER_ENGAGEMENT_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    // Per-contact daily message limit
    {
      scope: "contact",
      maxActions: 5,
      windowMs: 86_400_000, // 24 hours
    },
    // Per-org daily message limit
    {
      scope: "global",
      maxActions: 500,
      windowMs: 86_400_000, // 24 hours
    },
  ],
  cooldowns: [
    {
      actionType: "customer-engagement.appointment.book",
      cooldownMs: 3_600_000, // 1 hour
      scope: "contact",
    },
    {
      actionType: "customer-engagement.reminder.send",
      cooldownMs: 14_400_000, // 4 hours
      scope: "contact",
    },
    {
      actionType: "customer-engagement.review.request",
      cooldownMs: 2_592_000_000, // 30 days
      scope: "contact",
    },
    {
      actionType: "customer-engagement.cadence.start",
      cooldownMs: 604_800_000, // 7 days
      scope: "contact",
    },
    {
      actionType: "customer-engagement.pipeline.diagnose",
      cooldownMs: 300_000, // 5 minutes
      scope: "global",
    },
  ],
  protectedEntities: [],
};
