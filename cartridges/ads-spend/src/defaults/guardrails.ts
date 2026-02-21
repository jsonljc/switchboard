import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_ADS_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "ads.budget.adjust",
      maxActions: 10,
      windowMs: 60 * 60 * 1000, // 1 hour
    },
    {
      scope: "global",
      maxActions: 50,
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
    },
  ],
  cooldowns: [
    {
      actionType: "ads.budget.adjust",
      cooldownMs: 6 * 60 * 60 * 1000, // 6 hours
      scope: "campaign",
    },
  ],
  protectedEntities: [],
};
