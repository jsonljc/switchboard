// ---------------------------------------------------------------------------
// LTV Scoring — Deterministic lifetime value prediction
// ---------------------------------------------------------------------------

import type { LTVScoreInput, LTVScoreResult } from "../types.js";

/**
 * Compute a deterministic LTV estimate.
 *
 * LTV = (frequency × ATV × retentionDecay) + referralValue - noShowCost
 *
 * Retention decay: 0.85^year (15% annual churn rate assumption)
 * Referral value: $200 per referral (average new-patient value)
 * No-show cost: $75 per no-show (lost revenue + admin overhead)
 */
export function computeLTV(input: LTVScoreInput): LTVScoreResult {
  const REFERRAL_VALUE = 200;
  const NO_SHOW_COST = 75;
  const RETENTION_DECAY_RATE = 0.85;
  const PROJECTION_YEARS = 5;

  // Base value: sum of projected revenue with decay over PROJECTION_YEARS
  let baseValue = 0;
  const yearsToProject = Math.min(input.retentionYears, PROJECTION_YEARS);
  for (let year = 0; year < yearsToProject; year++) {
    const decayFactor = Math.pow(RETENTION_DECAY_RATE, year);
    baseValue += input.averageTreatmentValue * input.visitFrequencyPerYear * decayFactor;
  }

  const retentionDecay = Math.pow(RETENTION_DECAY_RATE, yearsToProject);
  const referralValue = input.referralCount * REFERRAL_VALUE;
  const noShowCost = input.noShowCount * NO_SHOW_COST;

  const estimatedLTV = Math.round(baseValue + referralValue - noShowCost);

  return {
    estimatedLTV: Math.max(0, estimatedLTV),
    tier: ltvTier(estimatedLTV),
    components: {
      baseValue: Math.round(baseValue),
      referralValue,
      noShowCost,
      retentionDecay,
    },
  };
}

function ltvTier(ltv: number): LTVScoreResult["tier"] {
  if (ltv >= 10_000) return "platinum";
  if (ltv >= 5_000) return "gold";
  if (ltv >= 2_000) return "silver";
  return "bronze";
}
