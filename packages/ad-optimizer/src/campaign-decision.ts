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
    ...(input.sourceComparison ? { sourceComparison: input.sourceComparison } : {}),
  });

  for (const rec of campaignRecs) {
    const tiered = applyTier({
      recommendation: rec,
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
