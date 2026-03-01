// ---------------------------------------------------------------------------
// Default Guardrails
// ---------------------------------------------------------------------------
// Rate limits, cooldowns, and protected entities for the digital-ads
// cartridge. Covers both API rate-limit protection (reads) and
// mutation safety (writes).
// ---------------------------------------------------------------------------

import type { GuardrailConfig } from "../types.js";

export const DEFAULT_DIGITAL_ADS_GUARDRAILS: GuardrailConfig = {
  rateLimits: [
    // Read action rate limits (API protection)
    {
      scope: "platform",
      maxActions: 4,
      windowMs: 1000,
    },
    {
      scope: "platform",
      maxActions: 10,
      windowMs: 1000,
    },
    {
      scope: "global",
      maxActions: 30,
      windowMs: 60_000,
    },
    // Write action rate limits
    {
      scope: "global",
      maxActions: 50,
      windowMs: 86_400_000,
    },
  ],
  cooldowns: [
    // Read cooldowns
    {
      actionType: "digital-ads.funnel.diagnose",
      cooldownMs: 30_000,
      scope: "entityId",
    },
    {
      actionType: "digital-ads.structure.analyze",
      cooldownMs: 30_000,
      scope: "entityId",
    },
    // Write cooldowns
    {
      actionType: "digital-ads.campaign.adjust_budget",
      cooldownMs: 21_600_000, // 6 hours
      scope: "entityId",
    },
    {
      actionType: "digital-ads.adset.adjust_budget",
      cooldownMs: 21_600_000, // 6 hours
      scope: "entityId",
    },
  ],
  protectedEntities: [],
};

// Keep backward-compatible alias
export const DEFAULT_GUARDRAILS = DEFAULT_DIGITAL_ADS_GUARDRAILS;
