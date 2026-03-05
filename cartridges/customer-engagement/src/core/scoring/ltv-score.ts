// ---------------------------------------------------------------------------
// LTV Scoring — Deterministic lifetime value prediction
// ---------------------------------------------------------------------------

import type { LTVScoreInput, LTVScoreResult } from "../types.js";

/** LTV scoring constants that can be overridden via business profile. */
export interface LTVScoringConfig {
  referralValue?: number;
  noShowCost?: number;
  retentionDecayRate?: number;
  projectionYears?: number;
}

/** Default LTV scoring constants. */
export const DEFAULT_LTV_CONFIG: Required<LTVScoringConfig> = {
  referralValue: 200,
  noShowCost: 75,
  retentionDecayRate: 0.85,
  projectionYears: 5,
};

/**
 * Compute a deterministic LTV estimate.
 *
 * LTV = (frequency × ATV × retentionDecay) + referralValue - noShowCost
 *
 * When `config` is provided (from a business profile), uses those constants.
 * Falls back to hardcoded defaults otherwise.
 */
export function computeLTV(input: LTVScoreInput, config?: LTVScoringConfig): LTVScoreResult {
  const referralValue = config?.referralValue ?? DEFAULT_LTV_CONFIG.referralValue;
  const noShowCost = config?.noShowCost ?? DEFAULT_LTV_CONFIG.noShowCost;
  const retentionDecayRate = config?.retentionDecayRate ?? DEFAULT_LTV_CONFIG.retentionDecayRate;
  const projectionYears = config?.projectionYears ?? DEFAULT_LTV_CONFIG.projectionYears;

  // Base value: sum of projected revenue with decay over projectionYears
  let baseValue = 0;
  const yearsToProject = Math.min(input.retentionYears, projectionYears);
  for (let year = 0; year < yearsToProject; year++) {
    const decayFactor = Math.pow(retentionDecayRate, year);
    baseValue += input.averageServiceValue * input.visitFrequencyPerYear * decayFactor;
  }

  const retentionDecay = Math.pow(retentionDecayRate, yearsToProject);
  const refValue = input.referralCount * referralValue;
  const nsCost = input.noShowCount * noShowCost;

  const estimatedLTV = Math.round(baseValue + refValue - nsCost);

  return {
    estimatedLTV: Math.max(0, estimatedLTV),
    tier: ltvTier(estimatedLTV),
    components: {
      baseValue: Math.round(baseValue),
      referralValue: refValue,
      noShowCost: nsCost,
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
