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
    // Audience creation cooldown (5 min per account)
    {
      actionType: "digital-ads.audience.custom.create",
      cooldownMs: 300_000, // 5 minutes
      scope: "global",
    },
    {
      actionType: "digital-ads.audience.lookalike.create",
      cooldownMs: 300_000, // 5 minutes
      scope: "global",
    },
    // Bid strategy cooldown (6h per entity — learning phase)
    {
      actionType: "digital-ads.bid.update_strategy",
      cooldownMs: 21_600_000, // 6 hours
      scope: "entityId",
    },
    // Budget reallocation cooldown (12h per account)
    {
      actionType: "digital-ads.budget.reallocate",
      cooldownMs: 43_200_000, // 12 hours
      scope: "global",
    },
    // Creative rotation cooldown (24h per campaign)
    {
      actionType: "digital-ads.creative.rotate",
      cooldownMs: 86_400_000, // 24 hours
      scope: "entityId",
    },
    // Optimization batch cooldown (4h per account)
    {
      actionType: "digital-ads.optimization.apply",
      cooldownMs: 14_400_000, // 4 hours
      scope: "global",
    },
    // Rule creation cooldown (10 min)
    {
      actionType: "digital-ads.rule.create",
      cooldownMs: 600_000, // 10 minutes
      scope: "global",
    },
    // Lift study creation cooldown (1h global)
    {
      actionType: "digital-ads.measurement.lift_study.create",
      cooldownMs: 3_600_000, // 1 hour
      scope: "global",
    },
    // Flight plan creation cooldown (5 min)
    {
      actionType: "digital-ads.pacing.create_flight",
      cooldownMs: 300_000, // 5 minutes
      scope: "global",
    },
    // Pacing auto-adjust cooldown (6h per flight)
    {
      actionType: "digital-ads.pacing.auto_adjust",
      cooldownMs: 21_600_000, // 6 hours
      scope: "entityId",
    },
    // Catalog product set creation cooldown (5 min)
    {
      actionType: "digital-ads.catalog.product_sets",
      cooldownMs: 300_000, // 5 minutes
      scope: "global",
    },
    // Creative test creation cooldown (10 min)
    {
      actionType: "digital-ads.creative.test_create",
      cooldownMs: 600_000, // 10 minutes
      scope: "global",
    },
    // Creative test conclusion cooldown (1h per test)
    {
      actionType: "digital-ads.creative.test_conclude",
      cooldownMs: 3_600_000, // 1 hour
      scope: "entityId",
    },
    // Notification configuration cooldown (5 min)
    {
      actionType: "digital-ads.alert.configure_notifications",
      cooldownMs: 300_000, // 5 minutes
      scope: "global",
    },
    // Memory record cooldown (1 sec — prevent rapid-fire recording)
    {
      actionType: "digital-ads.memory.record",
      cooldownMs: 1_000, // 1 second
      scope: "global",
    },
    // Memory outcome cooldown (5 min per record — prevent premature re-recording)
    {
      actionType: "digital-ads.memory.record_outcome",
      cooldownMs: 300_000, // 5 minutes
      scope: "entityId",
    },
    // Memory import cooldown (1 min — prevent accidental re-imports)
    {
      actionType: "digital-ads.memory.import",
      cooldownMs: 60_000, // 1 minute
      scope: "global",
    },
    // Geo experiment creation cooldown (1h global — prevent duplicate experiments)
    {
      actionType: "digital-ads.geo_experiment.create",
      cooldownMs: 3_600_000, // 1 hour
      scope: "global",
    },
    // Geo experiment conclusion cooldown (24h per experiment)
    {
      actionType: "digital-ads.geo_experiment.conclude",
      cooldownMs: 86_400_000, // 24 hours
      scope: "entityId",
    },
    // Seasonal event creation cooldown (1 min — prevent accidental duplicates)
    {
      actionType: "digital-ads.seasonal.add_event",
      cooldownMs: 60_000, // 1 minute
      scope: "global",
    },
  ],
  protectedEntities: [],
};

// Keep backward-compatible alias
export const DEFAULT_GUARDRAILS = DEFAULT_DIGITAL_ADS_GUARDRAILS;
