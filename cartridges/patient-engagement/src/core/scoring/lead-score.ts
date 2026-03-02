// ---------------------------------------------------------------------------
// Lead Scoring — Deterministic 0-100 scoring
// ---------------------------------------------------------------------------

import type { LeadScoreInput, LeadScoreResult } from "../types.js";

/**
 * Compute a deterministic lead score from 0-100.
 *
 * Factors and their max contributions:
 * - Treatment value:     20 points
 * - Urgency:             15 points
 * - Event-driven:        10 points
 * - Budget indicator:    10 points
 * - Engagement:          15 points
 * - Response speed:      10 points
 * - Source quality:       8 points
 * - Returning patient:    7 points
 * - Medical penalty:     -5 points (if has existing medical history requiring clearance)
 */
export function computeLeadScore(input: LeadScoreInput): LeadScoreResult {
  const factors: Array<{ factor: string; contribution: number }> = [];

  // Treatment value: $0 = 0pts, $500+ = 20pts, linear between
  const tvScore = Math.min(20, (input.treatmentValue / 500) * 20);
  factors.push({ factor: "treatment_value", contribution: tvScore });

  // Urgency: 0-10 scale → 0-15 points
  const urgencyScore = (input.urgencyLevel / 10) * 15;
  factors.push({ factor: "urgency", contribution: urgencyScore });

  // Event-driven: binary 10 points
  const eventScore = input.eventDriven ? 10 : 0;
  factors.push({ factor: "event_driven", contribution: eventScore });

  // Budget indicator: 0-10 → 0-10 points
  const budgetScore = input.budgetIndicator;
  factors.push({ factor: "budget", contribution: budgetScore });

  // Engagement: 0-10 → 0-15 points
  const engagementScore = (input.engagementScore / 10) * 15;
  factors.push({ factor: "engagement", contribution: engagementScore });

  // Response speed: < 5min = 10pts, < 30min = 7pts, < 1hr = 4pts, else 0
  let speedScore = 0;
  if (input.responseSpeedMs !== null) {
    const minutes = input.responseSpeedMs / 60_000;
    if (minutes < 5) speedScore = 10;
    else if (minutes < 30) speedScore = 7;
    else if (minutes < 60) speedScore = 4;
  }
  factors.push({ factor: "response_speed", contribution: speedScore });

  // Source quality
  const sourceScores: Record<string, number> = {
    referral: 8,
    organic: 6,
    walk_in: 5,
    paid: 4,
    other: 2,
  };
  const sourceScore = sourceScores[input.source] ?? 2;
  factors.push({ factor: "source", contribution: sourceScore });

  // Returning patient bonus
  const returningScore = input.isReturning ? 7 : 0;
  factors.push({ factor: "returning", contribution: returningScore });

  // Medical history penalty (complex cases may not convert quickly)
  const medicalPenalty = input.hasMedicalHistory ? -5 : 0;
  factors.push({ factor: "medical_history", contribution: medicalPenalty });

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
