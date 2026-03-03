// ---------------------------------------------------------------------------
// Treatment Affinity — Deterministic cross-sell matrix
// ---------------------------------------------------------------------------

import type { TreatmentType, TreatmentAffinityInput, TreatmentAffinityResult } from "../types.js";

/**
 * Base affinity matrix: source treatment → target treatment → affinity (0-1).
 * Built from industry co-treatment patterns.
 */
const AFFINITY_MATRIX: Partial<Record<TreatmentType, Partial<Record<TreatmentType, number>>>> = {
  botox: { filler: 0.8, chemical_peel: 0.5, laser: 0.4, microneedling: 0.3 },
  filler: { botox: 0.8, chemical_peel: 0.4, laser: 0.3, microneedling: 0.3 },
  laser: { chemical_peel: 0.6, microneedling: 0.5, botox: 0.4, filler: 0.3 },
  chemical_peel: { microneedling: 0.7, laser: 0.6, botox: 0.3, filler: 0.3 },
  microneedling: { chemical_peel: 0.7, laser: 0.5, filler: 0.3, botox: 0.2 },
  dental_cleaning: { whitening: 0.7, orthodontics: 0.3, general_checkup: 0.2 },
  whitening: { dental_cleaning: 0.6, crowns: 0.3 },
  orthodontics: { whitening: 0.4, dental_cleaning: 0.3 },
  implants: { crowns: 0.6, dental_cleaning: 0.3 },
  crowns: { implants: 0.5, whitening: 0.3, dental_cleaning: 0.3 },
  general_checkup: { dental_cleaning: 0.5, whitening: 0.2 },
};

/**
 * Age-based affinity modifiers.
 */
const AGE_MODIFIERS: Partial<Record<string, Partial<Record<TreatmentType, number>>>> = {
  "18-25": { chemical_peel: 1.2, orthodontics: 1.3, whitening: 1.2, botox: 0.7 },
  "26-35": { botox: 1.1, filler: 1.1, microneedling: 1.2, whitening: 1.1 },
  "36-45": { botox: 1.3, filler: 1.2, laser: 1.1 },
  "46-55": { botox: 1.2, filler: 1.3, laser: 1.2, implants: 1.1 },
  "56-65": { implants: 1.3, crowns: 1.2, laser: 1.1, filler: 1.1 },
  "65+": { implants: 1.4, crowns: 1.3, dental_cleaning: 1.1 },
};

/**
 * Compute deterministic treatment affinities for cross-sell recommendations.
 */
export function computeTreatmentAffinity(input: TreatmentAffinityInput): TreatmentAffinityResult {
  const baseAffinities = AFFINITY_MATRIX[input.currentTreatment] ?? {};
  const ageModifiers = AGE_MODIFIERS[input.ageRange] ?? {};

  const candidates: Array<{
    treatment: TreatmentType;
    affinityScore: number;
    reason: string;
  }> = [];

  for (const [treatment, baseScore] of Object.entries(baseAffinities)) {
    const tt = treatment as TreatmentType;

    // Skip if already done recently
    if (input.previousTreatments.includes(tt)) continue;

    // Apply age modifier
    const ageMod = ageModifiers[tt] ?? 1.0;

    // Apply budget modifier: higher budget = more expensive treatments score better
    const budgetMod = input.budgetIndicator >= 7 ? 1.2 : input.budgetIndicator >= 4 ? 1.0 : 0.8;

    const finalScore = Math.min(1, (baseScore ?? 0) * ageMod * budgetMod);

    if (finalScore >= 0.2) {
      candidates.push({
        treatment: tt,
        affinityScore: Math.round(finalScore * 100) / 100,
        reason: buildReason(input.currentTreatment, tt, ageMod, budgetMod),
      });
    }
  }

  // Sort by affinity descending, take top 3
  candidates.sort((a, b) => b.affinityScore - a.affinityScore);

  return { recommendations: candidates.slice(0, 3) };
}

function buildReason(
  from: TreatmentType,
  _to: TreatmentType,
  ageMod: number,
  budgetMod: number,
): string {
  const parts: string[] = [`High co-treatment rate with ${from}`];
  if (ageMod > 1.0) parts.push("age-adjusted boost");
  if (budgetMod > 1.0) parts.push("budget-aligned");
  return parts.join("; ");
}
