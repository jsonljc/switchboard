import type {
  CampaignInsightSchema as CampaignInsight,
  RecommendationOutputSchema as RecommendationOutput,
  AdSetDetailSchema as AdSetDetail,
  TrendAnalysisSchema as TrendAnalysis,
  BudgetAnalysisSchema as BudgetAnalysis,
  CampaignBudgetEntrySchema as CampaignBudgetEntry,
  MetricSnapshotSchema as MetricSnapshot,
  AdSetLearningInput,
} from "@switchboard/schemas";
import { LearningPhaseGuardV2 } from "./learning-phase-guard.js";
import { detectFunnelShape } from "./funnel-detector.js";
import { detectTrends } from "./trend-engine.js";
import { analyzeBudgetDistribution } from "./budget-analyzer.js";
import { resetsLearningFor } from "./action-reset-classification.js";

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export interface V2SectionsInput {
  adSetData: AdSetLearningInput[] | null;
  trendRawData: {
    day30: MetricSnapshot;
    day60: MetricSnapshot;
    day90: MetricSnapshot;
    weekly: MetricSnapshot[];
  } | null;
  currentInsights: CampaignInsight[];
  learningGuardV2: LearningPhaseGuardV2;
  targetCPA: number;
}

export interface V2SectionsResult {
  adSetDetails: AdSetDetail[] | undefined;
  adSetsInLearning: number;
  adSetsLearningLimited: number;
  trends: TrendAnalysis | undefined;
  budgetDistribution: BudgetAnalysis | undefined;
  /** Learning-limited recommendations produced by the ad-set scan. The caller
   * pushes these into the audit's `recommendations` array (was an in-place
   * mutation before this extraction). */
  learningLimitedRecs: RecommendationOutput[];
}

/**
 * V2 audit analysis sections — ad-set-level learning + details, rolling trends,
 * and budget distribution. Extracted verbatim from `AuditRunner.run` Steps 6-8
 * for file headroom and isolated testability. Pure: no provider calls, no `this`;
 * the per-ad-set classifier is injected so the runner keeps a single instance.
 */
export function analyzeV2Sections(input: V2SectionsInput): V2SectionsResult {
  const { adSetData, trendRawData, currentInsights, learningGuardV2, targetCPA } = input;
  const learningLimitedRecs: RecommendationOutput[] = [];

  // Step 6: V2 — Ad set level learning + details
  let adSetsInLearning = 0;
  let adSetsLearningLimited = 0;
  let adSetDetails: AdSetDetail[] | undefined;

  if (adSetData) {
    adSetDetails = adSetData.map((adSetInput) => {
      const learningStatus = learningGuardV2.classifyState(adSetInput);

      if (learningStatus.state === "learning") {
        adSetsInLearning++;
      } else if (learningStatus.state === "learning_limited") {
        adSetsLearningLimited++;
      }

      const destinationType = adSetInput.destinationType ?? "WEBSITE";
      const funnelShape = detectFunnelShape(destinationType);

      if (learningStatus.state === "learning_limited") {
        const diagnosis = learningGuardV2.diagnoseLearningLimited(learningStatus, adSetInput);
        const msg = `Ad set ${adSetInput.adSetId} is Learning Limited (${diagnosis.cause}). Recommended: ${diagnosis.recommendation}.`;
        learningLimitedRecs.push({
          type: "recommendation",
          campaignId: adSetInput.campaignId,
          campaignName: adSetInput.adSetName,
          action: diagnosis.recommendation as RecommendationOutput["action"],
          confidence: 0.75,
          urgency: "this_week",
          estimatedImpact: msg,
          steps: [msg],
          learningPhaseImpact:
            diagnosis.recommendation === "expand_targeting" ? "will reset learning" : "no impact",
          resetsLearning: resetsLearningFor(
            diagnosis.recommendation as RecommendationOutput["action"],
          ),
        });
      }

      return {
        adSetId: adSetInput.adSetId,
        adSetName: adSetInput.adSetName,
        campaignId: adSetInput.campaignId,
        destinationType,
        funnelShape,
        frequency: adSetInput.frequency,
        learningStatus,
        hasFrequencyCap: adSetInput.hasFrequencyCap ?? false,
      };
    });
  }

  // Step 7: V2 — Trends
  let trends: TrendAnalysis | undefined;
  if (trendRawData) {
    const weeklyTrends = detectTrends(trendRawData.weekly);
    trends = {
      rollingAverages: {
        day30: trendRawData.day30,
        day60: trendRawData.day60,
        day90: trendRawData.day90,
      },
      weeklySnapshots: trendRawData.weekly.map((w, i) => ({
        weekStart: `week-${i}`,
        weekEnd: `week-${i}`,
        metrics: w,
      })),
      trends: weeklyTrends,
    };
  }

  // Step 8: V2 — Budget distribution
  let budgetDistribution: BudgetAnalysis | undefined;
  if (currentInsights.length >= 2) {
    const totalSpendAll = currentInsights.reduce((sum, i) => sum + i.spend, 0);
    const budgetEntries: CampaignBudgetEntry[] = currentInsights.map((insight) => ({
      campaignId: insight.campaignId,
      campaignName: insight.campaignName,
      spendShare: safeDivide(insight.spend, totalSpendAll),
      spend: insight.spend,
      cpa: safeDivide(insight.spend, insight.conversions),
      roas: safeDivide(insight.revenue, insight.spend),
      isCbo: false,
      dailyBudget: null,
      lifetimeBudget: null,
      spendCap: null,
      objective: "CONVERSIONS",
    }));
    budgetDistribution = analyzeBudgetDistribution(budgetEntries, targetCPA, null);
  }

  return {
    adSetDetails,
    adSetsInLearning,
    adSetsLearningLimited,
    trends,
    budgetDistribution,
    learningLimitedRecs,
  };
}
