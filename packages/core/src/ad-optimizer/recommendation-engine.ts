// packages/core/src/ad-optimizer/recommendation-engine.ts
import type { Diagnosis } from "./metric-diagnostician.js";
import type {
  RecommendationOutputSchema as RecommendationOutput,
  MetricDeltaSchema as MetricDelta,
  UrgencySchema as Urgency,
} from "@switchboard/schemas";

// ── Re-export types ──

export type { RecommendationOutput };

// ── Constants ──

const MAX_BUDGET_INCREASE_PERCENT = 20;
const KILL_CPA_MULTIPLIER = 2;
const KILL_DAYS_THRESHOLD = 7;

// ── Input type ──

export interface RecommendationInput {
  campaignId: string;
  campaignName: string;
  diagnoses: Diagnosis[];
  deltas: MetricDelta[];
  targetCPA: number;
  targetROAS: number;
  currentSpend: number;
  daysAboveTarget: number;
}

// ── Helpers ──

function getCPA(deltas: MetricDelta[]): number {
  return deltas.find((d) => d.metric === "cpa")?.current ?? 0;
}

function hasDiagnosis(diagnoses: Diagnosis[], pattern: string): boolean {
  return diagnoses.some((d) => d.pattern === pattern);
}

function makeRec(
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  action: RecommendationOutput["action"],
  confidence: number,
  urgency: Urgency,
  estimatedImpact: string,
  steps: string[],
  learningPhaseImpact: string,
): RecommendationOutput {
  return {
    type: "recommendation",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    action,
    confidence,
    urgency,
    estimatedImpact,
    steps,
    learningPhaseImpact,
  };
}

// ── Main export ──

export function generateRecommendations(input: RecommendationInput): RecommendationOutput[] {
  const { campaignId, campaignName, diagnoses, deltas, targetCPA, daysAboveTarget } = input;
  const cpa = getCPA(deltas);
  const results: RecommendationOutput[] = [];
  const base = { campaignId, campaignName };

  // Kill rule: CPA > 2x targetCPA AND daysAboveTarget >= 7
  if (cpa > KILL_CPA_MULTIPLIER * targetCPA && daysAboveTarget >= KILL_DAYS_THRESHOLD) {
    const multiplier = (cpa / targetCPA).toFixed(1);
    results.push(
      makeRec(
        base,
        "kill",
        0.85,
        "immediate",
        "Campaign is significantly over target CPA and should be paused immediately",
        [
          "Pause campaign in Ads Manager",
          `CPA has been ${multiplier}x target for ${daysAboveTarget} days`,
        ],
        "no impact",
      ),
    );
  }

  // Scale rule: CPA > 0 AND CPA < 0.8x targetCPA AND daysAboveTarget===0 AND no diagnoses
  if (cpa > 0 && cpa < 0.8 * targetCPA && daysAboveTarget === 0 && diagnoses.length === 0) {
    results.push(
      makeRec(
        base,
        "scale",
        0.7,
        "this_week",
        `Campaign is performing well under target CPA — scale budget by up to ${MAX_BUDGET_INCREASE_PERCENT}%`,
        [
          `Approve draft with ${MAX_BUDGET_INCREASE_PERCENT}% higher budget`,
          `Budget increase capped at ${MAX_BUDGET_INCREASE_PERCENT}%`,
        ],
        "will reset learning",
      ),
    );
  }

  // Refresh creative: creative_fatigue → confidence 0.85
  if (hasDiagnosis(diagnoses, "creative_fatigue")) {
    results.push(
      makeRec(
        base,
        "refresh_creative",
        0.85,
        "this_week",
        "Fatigued creatives are reducing engagement — new creative will restore performance",
        ["Trigger PCD for fresh creative", "Replace fatigued creatives", "Approve new draft"],
        "will reset learning",
      ),
    );
  }

  // Refresh creative: audience_saturation → confidence 0.7
  if (
    hasDiagnosis(diagnoses, "audience_saturation") &&
    !hasDiagnosis(diagnoses, "creative_fatigue")
  ) {
    results.push(
      makeRec(
        base,
        "refresh_creative",
        0.7,
        "this_week",
        "Saturated audience needs fresh creative to re-engage",
        ["Trigger PCD for fresh creative", "Replace fatigued creatives", "Approve new draft"],
        "will reset learning",
      ),
    );
  }

  // Restructure: audience_saturation
  if (hasDiagnosis(diagnoses, "audience_saturation")) {
    results.push(
      makeRec(
        base,
        "restructure",
        0.65,
        "next_cycle",
        "Audience is saturated — expanding targeting will find new reach",
        ["Create new ad set with expanded targeting", "Approve new ad set draft"],
        "will reset learning",
      ),
    );
  }

  // Hold: landing_page_drop
  if (hasDiagnosis(diagnoses, "landing_page_drop")) {
    results.push(
      makeRec(
        base,
        "hold",
        0.75,
        "this_week",
        "Landing page issues are driving up costs — fix before increasing spend",
        ["Check landing page load speed", "Verify tracking pixel", "Hold budget changes"],
        "no impact",
      ),
    );
  }

  return results;
}
