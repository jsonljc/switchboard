// ---------------------------------------------------------------------------
// Lead Scoring — Deterministic 0-100 scoring
// ---------------------------------------------------------------------------

import type { LeadScoreInput, LeadScoreResult } from "../types.js";

/** Configurable weights for lead scoring factors. */
export interface LeadScoreWeights {
  treatmentValue?: number;
  urgency?: number;
  eventDriven?: number;
  budget?: number;
  engagement?: number;
  responseSpeed?: number;
  sourceScores?: Record<string, number>;
  returning?: number;
  medicalPenalty?: number;
}

/** Default lead scoring weights. */
export const DEFAULT_LEAD_SCORE_WEIGHTS: Required<LeadScoreWeights> = {
  treatmentValue: 20,
  urgency: 15,
  eventDriven: 10,
  budget: 10,
  engagement: 15,
  responseSpeed: 10,
  sourceScores: { referral: 8, organic: 6, walk_in: 5, paid: 4, other: 2 },
  returning: 7,
  medicalPenalty: -5,
};

/**
 * Compute a deterministic lead score from 0-100.
 *
 * When `weights` is provided (from a business profile), uses those weights.
 * Falls back to DEFAULT_LEAD_SCORE_WEIGHTS otherwise.
 */
export function computeLeadScore(
  input: LeadScoreInput,
  weights?: LeadScoreWeights,
): LeadScoreResult {
  const tvMax = weights?.treatmentValue ?? DEFAULT_LEAD_SCORE_WEIGHTS.treatmentValue;
  const urgencyMax = weights?.urgency ?? DEFAULT_LEAD_SCORE_WEIGHTS.urgency;
  const eventMax = weights?.eventDriven ?? DEFAULT_LEAD_SCORE_WEIGHTS.eventDriven;
  const budgetMax = weights?.budget ?? DEFAULT_LEAD_SCORE_WEIGHTS.budget;
  const engagementMax = weights?.engagement ?? DEFAULT_LEAD_SCORE_WEIGHTS.engagement;
  const speedMax = weights?.responseSpeed ?? DEFAULT_LEAD_SCORE_WEIGHTS.responseSpeed;
  const srcScores = weights?.sourceScores ?? DEFAULT_LEAD_SCORE_WEIGHTS.sourceScores;
  const retBonus = weights?.returning ?? DEFAULT_LEAD_SCORE_WEIGHTS.returning;
  const medPenalty = weights?.medicalPenalty ?? DEFAULT_LEAD_SCORE_WEIGHTS.medicalPenalty;

  const factors: Array<{ factor: string; contribution: number }> = [];

  // Treatment value: $0 = 0pts, $500+ = max pts, linear between
  const tvScore = Math.min(tvMax, (input.serviceValue / 500) * tvMax);
  factors.push({ factor: "treatment_value", contribution: tvScore });

  // Urgency: 0-10 scale → 0-max points
  const urgencyScore = (input.urgencyLevel / 10) * urgencyMax;
  factors.push({ factor: "urgency", contribution: urgencyScore });

  // Event-driven: binary max points
  const eventScore = input.eventDriven ? eventMax : 0;
  factors.push({ factor: "event_driven", contribution: eventScore });

  // Budget indicator: 0-10 → 0-max points
  const budgetScore = (input.budgetIndicator / 10) * budgetMax;
  factors.push({ factor: "budget", contribution: budgetScore });

  // Engagement: 0-10 → 0-max points
  const engagementScore = (input.engagementScore / 10) * engagementMax;
  factors.push({ factor: "engagement", contribution: engagementScore });

  // Response speed: < 5min = max, < 30min = 70%, < 1hr = 40%, else 0
  let speedScore = 0;
  if (input.responseSpeedMs !== null) {
    const minutes = input.responseSpeedMs / 60_000;
    if (minutes < 5) speedScore = speedMax;
    else if (minutes < 30) speedScore = speedMax * 0.7;
    else if (minutes < 60) speedScore = speedMax * 0.4;
  }
  factors.push({ factor: "response_speed", contribution: speedScore });

  // Source quality
  const sourceScore = srcScores[input.source] ?? 2;
  factors.push({ factor: "source", contribution: sourceScore });

  // Returning patient bonus
  const returningScore = input.isReturning ? retBonus : 0;
  factors.push({ factor: "returning", contribution: returningScore });

  // Medical history penalty (complex cases may not convert quickly)
  const medicalPenaltyScore = input.hasMedicalHistory ? medPenalty : 0;
  factors.push({ factor: "medical_history", contribution: medicalPenaltyScore });

  const rawScore = factors.reduce((sum, f) => sum + f.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    score,
    tier: scoreTier(score),
    factors,
  };
}

function scoreTier(score: number): LeadScoreResult["tier"] {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  if (score >= 25) return "cool";
  return "cold";
}
