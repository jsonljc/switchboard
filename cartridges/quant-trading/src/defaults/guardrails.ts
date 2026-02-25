import type { GuardrailConfig } from "@switchboard/schemas";

export const DEFAULT_TRADING_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    {
      scope: "global",
      maxActions: 10,
      windowMs: 60 * 1000, // 10 orders per minute
    },
    {
      scope: "trading.order.*",
      maxActions: 100,
      windowMs: 24 * 60 * 60 * 1000, // 100 orders per day
    },
  ],
  cooldowns: [
    {
      actionType: "trading.order.market_buy",
      cooldownMs: 30 * 1000, // 30s per-symbol cooldown
      scope: "symbol",
    },
    {
      actionType: "trading.order.market_sell",
      cooldownMs: 30 * 1000,
      scope: "symbol",
    },
    {
      actionType: "trading.portfolio.rebalance",
      cooldownMs: 60 * 60 * 1000, // 1 hour cooldown
      scope: "portfolio",
    },
  ],
  protectedEntities: [],
};
