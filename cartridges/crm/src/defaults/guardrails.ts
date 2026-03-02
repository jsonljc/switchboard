import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_CRM_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "crm.contact.create",
      maxActions: 50,
      windowMs: 60 * 60 * 1000, // 50/hr
    },
    {
      scope: "crm.contact.update",
      maxActions: 100,
      windowMs: 60 * 60 * 1000, // 100/hr
    },
    {
      scope: "crm.deal.create",
      maxActions: 30,
      windowMs: 60 * 60 * 1000, // 30/hr
    },
    {
      scope: "global",
      maxActions: 500,
      windowMs: 24 * 60 * 60 * 1000, // 500/day
    },
  ],
  cooldowns: [
    {
      actionType: "crm.contact.update",
      cooldownMs: 5 * 60 * 1000, // 5 min
      scope: "customer",
    },
    {
      actionType: "crm.deal.create",
      cooldownMs: 10 * 60 * 1000, // 10 min
      scope: "customer",
    },
  ],
  protectedEntities: [],
};
