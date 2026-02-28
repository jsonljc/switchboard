import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_PAYMENTS_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "payments.refund.create",
      maxActions: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
    },
    {
      scope: "payments.charge.create",
      maxActions: 20,
      windowMs: 60 * 60 * 1000, // 1 hour
    },
    {
      scope: "payments.batch.invoice",
      maxActions: 3,
      windowMs: 24 * 60 * 60 * 1000, // 1 day
    },
    {
      scope: "global",
      maxActions: 100,
      windowMs: 24 * 60 * 60 * 1000, // 1 day
    },
  ],
  cooldowns: [
    {
      actionType: "payments.charge.create",
      cooldownMs: 30 * 60 * 1000, // 30 minutes
      scope: "customer",
    },
    {
      actionType: "payments.refund.create",
      cooldownMs: 4 * 60 * 60 * 1000, // 4 hours
      scope: "customer",
    },
    {
      actionType: "payments.subscription.modify",
      cooldownMs: 24 * 60 * 60 * 1000, // 24 hours
      scope: "customer",
    },
    {
      actionType: "payments.credit.apply",
      cooldownMs: 60 * 60 * 1000, // 1 hour
      scope: "customer",
    },
  ],
  protectedEntities: [],
};
