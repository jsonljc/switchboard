import type {
  CampaignInsightSchema as CampaignInsight,
  InsightOutputSchema as InsightOutput,
  WatchOutputSchema as WatchOutput,
  RecommendationOutputSchema as RecommendationOutput,
  LearningPhaseStatusSchema as LearningPhaseStatus,
  EconomicTierSchema as EconomicTier,
  MarginBasisSchema as MarginBasis,
  TargetBreachResult,
} from "@switchboard/schemas";
import { comparePeriods, type MetricSet } from "./period-comparator.js";
import { diagnose } from "./metric-diagnostician.js";
import { generateRecommendations } from "./recommendation-engine.js";
import { applyTier } from "./analyzers/economic-target.js";
import { LearningPhaseGuard } from "./learning-phase-guard.js";
import { evidenceFamilyFor } from "./evidence-floor.js";
import { resetsLearningFor } from "./action-reset-classification.js";

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function insightToMetrics(insight: CampaignInsight): MetricSet {
  const { spend, impressions, inlineLinkClicks, conversions, revenue, frequency } = insight;
  return {
    cpm: safeDivide(spend, impressions) * 1000,
    inlineLinkClickCtr: safeDivide(inlineLinkClicks, impressions) * 100,
    costPerInlineLinkClick: safeDivide(spend, inlineLinkClicks),
    cpl: safeDivide(spend, conversions),
    cpa: safeDivide(spend, conversions),
    roas: safeDivide(revenue, spend),
    frequency,
  };
}

const ZERO_METRICS: MetricSet = {
  cpm: 0,
  inlineLinkClickCtr: 0,
  costPerInlineLinkClick: 0,
  cpl: 0,
  cpa: 0,
  roas: 0,
  frequency: 0,
};

export interface CampaignDecisionInput {
  campaignId: string;
  campaignName: string;
  currentInsight: CampaignInsight;
  previousInsight: CampaignInsight | null;
  targetBreach: TargetBreachResult;
  learningStatus: LearningPhaseStatus;
  economicTier: EconomicTier;
  effectiveTarget: number;
  marginBasis: MarginBasis;
  targetROAS: number;
  nextCycleDate: string;
  sourceComparison?: Parameters<typeof generateRecommendations>[0]["sourceComparison"];
  /**
   * Phase-A Gate 1: when `false`, an account-wide conversion-denominator
   * step-change is suspected (an attribution-window/action-type reporting shift,
   * not a real performance drop). Riley DEMOTES every cost-number-driven or
   * learning-resetting rec to a `measurement_untrusted` watch this cycle, and only
   * lets measurement/diagnostic-and-non-resetting recs (fix_signal_health,
   * harden_capi_attribution, hold) keep flowing. `undefined` is treated as `true`.
   */
  measurementTrusted?: boolean;
}

export interface CampaignDecisionResult {
  insights: InsightOutput[];
  watches: WatchOutput[];
  recommendations: RecommendationOutput[];
}

const learningGuard = new LearningPhaseGuard();

/**
 * Pure per-campaign decision. Mirrors AuditRunner's former 5b–5g loop body
 * exactly (extracted for testability + the eval seam). Provider calls (learning
 * status, target breach) are inputs, so this is deterministic.
 */
export function decideForCampaign(input: CampaignDecisionInput): CampaignDecisionResult {
  const insights: InsightOutput[] = [];
  const watches: WatchOutput[] = [];
  const recommendations: RecommendationOutput[] = [];

  const current = insightToMetrics(input.currentInsight);
  const previous = input.previousInsight ? insightToMetrics(input.previousInsight) : ZERO_METRICS;
  const deltas = comparePeriods(current, previous);
  const diagnoses = diagnose(deltas);

  if (
    learningGuard.isPerformingWell(
      { cpa: current.cpa, roas: current.roas },
      { targetCPA: input.effectiveTarget, targetROAS: input.targetROAS },
    ) &&
    diagnoses.length === 0
  ) {
    insights.push({
      type: "insight",
      campaignId: input.campaignId,
      campaignName: input.campaignName,
      message: `Campaign has maintained ${current.roas.toFixed(1)}x ROAS. No changes recommended.`,
      category: "stable_performance",
    });
    return { insights, watches, recommendations };
  }

  const campaignRecs = generateRecommendations({
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    diagnoses,
    deltas,
    targetCPA: input.effectiveTarget,
    targetROAS: input.targetROAS,
    currentSpend: input.currentInsight.spend,
    targetBreach: input.targetBreach,
    evidence: {
      clicks: input.currentInsight.inlineLinkClicks,
      conversions: input.currentInsight.conversions,
      days: 7,
    },
    ...(input.sourceComparison ? { sourceComparison: input.sourceComparison } : {}),
  });

  for (const item of campaignRecs) {
    // Gate 2 abstentions arrive as watches straight from the engine.
    if (item.type === "watch") {
      watches.push(item);
      continue;
    }
    // Gate 1 abstention: when an account-wide conversion-denominator step-change
    // is suspected, the cost signal is untrustworthy this cycle. DEMOTE any
    // cost-number-driven (destructive/scale/structural) or learning-resetting rec
    // to a measurement_untrusted watch BEFORE applyTier. Measurement + diagnostic-
    // and-non-resetting recs (fix_signal_health, harden_capi_attribution, hold)
    // keep flowing so the user still gets the "fix your signal" path.
    const family = evidenceFamilyFor(item.action);
    const costDriven = family === "destructive" || family === "scale" || family === "structural";
    if (
      input.measurementTrusted === false &&
      (costDriven || resetsLearningFor(item.action) !== "no")
    ) {
      watches.push({
        type: "watch",
        campaignId: item.campaignId,
        campaignName: item.campaignName,
        pattern: "measurement_untrusted",
        message: `Holding "${item.action}": a suspected account-wide conversion-reporting shift makes the cost signal untrustworthy this cycle. ${item.estimatedImpact}`,
        checkBackDate: input.nextCycleDate,
      });
      continue;
    }
    const tiered = applyTier({
      recommendation: item,
      tier: input.economicTier,
      marginBasis: input.marginBasis,
      checkBackDate: input.nextCycleDate,
    });
    if (tiered.watch) {
      watches.push(tiered.watch);
      continue;
    }
    const gated = learningGuard.gate(tiered.recommendation!, input.learningStatus);
    if (gated.type === "watch") watches.push(gated);
    else recommendations.push(gated);
  }

  return { insights, watches, recommendations };
}
