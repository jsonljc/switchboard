// ---------------------------------------------------------------------------
// Revenue Growth Cartridge — Default Guardrails
// ---------------------------------------------------------------------------

import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_REVENUE_GROWTH_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "revenue-growth.*",
      maxActions: 10,
      windowMs: 3_600_000, // 1 hour
    },
    {
      scope: "revenue-growth.diagnostic.run",
      maxActions: 1,
      windowMs: 86_400_000, // 1 per day per account
    },
  ],
  cooldowns: [
    {
      actionType: "revenue-growth.diagnostic.run",
      cooldownMs: 3_600_000, // 1 hour between runs
      scope: "account",
    },
  ],
  protectedEntities: [],
};
