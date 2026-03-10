// ---------------------------------------------------------------------------
// Outcome Tracker — Checks measurement windows and evaluates outcomes
// ---------------------------------------------------------------------------

import type { Intervention, ConstraintType, OutcomeStatus } from "@switchboard/schemas";
import type { InterventionStore } from "../stores/interfaces.js";
import type { RevGrowthDeps } from "../data/normalizer.js";
import { collectNormalizedData } from "../data/normalizer.js";
import { scoreSignalHealth } from "../scorers/signal-health.js";
import { scoreCreativeDepth } from "../scorers/creative-depth.js";
import { scoreFunnelLeakage } from "../scorers/funnel-leakage.js";
import { scoreHeadroom } from "../scorers/headroom.js";
import { scoreSalesProcess } from "../scorers/sales-process.js";

export interface OutcomeCheckResult {
  interventionId: string;
  constraintType: ConstraintType;
  previousScore: number;
  currentScore: number;
  outcome: OutcomeStatus;
}

const SCORER_BY_CONSTRAINT: Record<
  string,
  (data: Parameters<typeof scoreSignalHealth>[0]) => { score: number }
> = {
  SIGNAL: scoreSignalHealth,
  CREATIVE: scoreCreativeDepth,
  FUNNEL: scoreFunnelLeakage,
  SATURATION: scoreHeadroom,
  SALES: scoreSalesProcess,
};

const IMPROVEMENT_THRESHOLD = 10;

export async function checkOutcomes(
  deps: RevGrowthDeps,
  accountId: string,
  organizationId: string,
): Promise<OutcomeCheckResult[]> {
  if (!deps.interventionStore) return [];

  const pendingInterventions = await deps.interventionStore.listPendingOutcomes();
  const results: OutcomeCheckResult[] = [];

  for (const intervention of pendingInterventions) {
    if (!isWindowElapsed(intervention)) continue;

    const result = await evaluateSingleOutcome(intervention, deps, accountId, organizationId);
    if (result) {
      await deps.interventionStore.updateOutcome(intervention.id, result.outcome);
      results.push(result);
    }
  }

  return results;
}

function isWindowElapsed(intervention: Intervention): boolean {
  if (!intervention.measurementStartedAt || !intervention.measurementWindowDays) return false;

  const startedAt = new Date(intervention.measurementStartedAt);
  const windowMs = intervention.measurementWindowDays * 24 * 60 * 60 * 1000;
  return Date.now() >= startedAt.getTime() + windowMs;
}

async function evaluateSingleOutcome(
  intervention: Intervention,
  deps: RevGrowthDeps,
  accountId: string,
  organizationId: string,
): Promise<OutcomeCheckResult | null> {
  const scorer = SCORER_BY_CONSTRAINT[intervention.constraintType];
  if (!scorer) return null;

  const normalizedData = await collectNormalizedData(accountId, organizationId, deps);
  const currentOutput = scorer(normalizedData);

  // The intervention's original score comes from the constraint identification
  // We look it up from the cycle's scorer outputs via the store
  const previousScore = getPreviousScore(intervention);
  const currentScore = currentOutput.score;
  const delta = currentScore - previousScore;

  let outcome: OutcomeStatus;
  if (delta >= IMPROVEMENT_THRESHOLD) {
    outcome = "IMPROVED";
  } else if (delta <= -IMPROVEMENT_THRESHOLD) {
    outcome = "REGRESSED";
  } else {
    outcome = "NO_CHANGE";
  }

  return {
    interventionId: intervention.id,
    constraintType: intervention.constraintType,
    previousScore,
    currentScore,
    outcome,
  };
}

function getPreviousScore(intervention: Intervention): number {
  // Extract the score from the intervention reasoning which contains the constraint score
  // Pattern: "score NN/threshold"
  const match = intervention.reasoning.match(/score (\d+)\//);
  if (match) {
    return Number(match[1]);
  }
  // Fallback: use priority as rough proxy (lower priority = higher score)
  return Math.max(0, 100 - intervention.priority * 15);
}

export type { InterventionStore };
