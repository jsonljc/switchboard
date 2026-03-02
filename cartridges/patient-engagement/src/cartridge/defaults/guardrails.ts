// ---------------------------------------------------------------------------
// Default Guardrails — Patient Engagement
// ---------------------------------------------------------------------------

import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_PATIENT_ENGAGEMENT_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    // Per-patient daily message limit
    {
      scope: "patient",
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
      actionType: "patient-engagement.appointment.book",
      cooldownMs: 3_600_000, // 1 hour
      scope: "patient",
    },
    {
      actionType: "patient-engagement.reminder.send",
      cooldownMs: 14_400_000, // 4 hours
      scope: "patient",
    },
    {
      actionType: "patient-engagement.review.request",
      cooldownMs: 2_592_000_000, // 30 days
      scope: "patient",
    },
    {
      actionType: "patient-engagement.cadence.start",
      cooldownMs: 604_800_000, // 7 days
      scope: "patient",
    },
    {
      actionType: "patient-engagement.pipeline.diagnose",
      cooldownMs: 300_000, // 5 minutes
      scope: "global",
    },
  ],
  protectedEntities: [],
};
