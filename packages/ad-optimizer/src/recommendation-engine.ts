// packages/core/src/ad-optimizer/recommendation-engine.ts
import type { Diagnosis } from "./metric-diagnostician.js";
import type {
  RecommendationOutputSchema as RecommendationOutput,
  MetricDeltaSchema as MetricDelta,
  UrgencySchema as Urgency,
  TargetBreachResult,
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
  targetBreach: TargetBreachResult;
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

function addKillRecommendation(
  results: RecommendationOutput[],
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  cpa: number,
  targetCPA: number,
  targetBreach: TargetBreachResult,
): void {
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
        `CPA has been ${multiplier}x target for ${targetBreach.periodsAboveTarget} days`,
      ],
      "no impact",
    ),
  );
}

function addReviewBudgetRecommendation(
  results: RecommendationOutput[],
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  cpa: number,
  targetCPA: number,
): void {
  const multiplier = (cpa / targetCPA).toFixed(1);
  results.push(
    makeRec(
      base,
      "review_budget",
      0.65,
      "this_week",
      `Campaign appears above target CPA (${multiplier}x) based on weekly snapshot data — treat as review signal`,
      [
        "Review campaign performance in Ads Manager",
        "Based on weekly snapshot data, not daily trend — exercise caution",
      ],
      "no impact",
    ),
  );
}

// ── Main export ──

export function generateRecommendations(input: RecommendationInput): RecommendationOutput[] {
  const { campaignId, campaignName, diagnoses, deltas, targetCPA, targetBreach } = input;
  const cpa = getCPA(deltas);
  const results: RecommendationOutput[] = [];
  const base = { campaignId, campaignName };

  const isAboveKillCpa = cpa > KILL_CPA_MULTIPLIER * targetCPA;

  // Daily data — high confidence pause/kill
  if (
    isAboveKillCpa &&
    targetBreach.granularity === "daily" &&
    targetBreach.periodsAboveTarget >= KILL_DAYS_THRESHOLD
  ) {
    addKillRecommendation(results, base, cpa, targetCPA, targetBreach);
  }

  // Weekly approximation — review/reduce-budget signal, NOT kill
  if (
    isAboveKillCpa &&
    targetBreach.granularity === "weekly" &&
    targetBreach.periodsAboveTarget >= 1
  ) {
    addReviewBudgetRecommendation(results, base, cpa, targetCPA);
  }

  // Scale rule: CPA > 0 AND CPA < 0.8x targetCPA AND periodsAboveTarget===0 AND no diagnoses
  if (
    cpa > 0 &&
    cpa < 0.8 * targetCPA &&
    targetBreach.periodsAboveTarget === 0 &&
    diagnoses.length === 0
  ) {
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
