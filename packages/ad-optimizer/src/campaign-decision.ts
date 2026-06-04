import type {
  CampaignInsightSchema as CampaignInsight,
  InsightOutputSchema as InsightOutput,
  WatchOutputSchema as WatchOutput,
  RecommendationOutputSchema as RecommendationOutput,
  LearningPhaseStatusSchema as LearningPhaseStatus,
  EconomicTierSchema as EconomicTier,
  TargetBreachResult,
  TargetSourceSchema as TargetSource,
} from "@switchboard/schemas";
import { comparePeriods, type MetricSet } from "./period-comparator.js";
import { diagnose } from "./metric-diagnostician.js";
import { generateRecommendations } from "./recommendation-engine.js";
import { applyTier } from "./analyzers/economic-target.js";
import { LearningPhaseGuard } from "./learning-phase-guard.js";
import { evidenceFamilyFor } from "./evidence-floor.js";
import { resetsLearningFor } from "./action-reset-classification.js";
import type { RevenueState } from "./revenue-state.js";

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
  /**
   * Account-level pre-flight state for this audit cycle (Riley v3 slice 1). This decision
   * reads two account-level signals from it:
   *  - `measurementTrusted` (producer 1): when `false`, an account-wide conversion-denominator
   *    step-change is suspected (an attribution-window/action-type reporting shift, not a real
   *    performance drop), so Riley DEMOTES every cost-number-driven or learning-resetting rec to
   *    a `measurement_untrusted` watch this cycle and only lets measurement/diagnostic-and-non-
   *    resetting recs (fix_signal_health, harden_capi_attribution, hold) keep flowing.
   *  - `marginBasis` (producer 3): feeds applyTier (currently always "unavailable").
   * The per-campaign `economicTier`/`effectiveTarget`/`targetSource` above are resolved
   * per-campaign and are NOT taken from RevenueState (which carries the ACCOUNT-level tier for
   * later slices).
   */
  revenueState: RevenueState;
  targetROAS: number;
  nextCycleDate: string;
  /**
   * Phase-A Task 8 (ad-set-granular learning lockout): when `true`, this campaign
   * has at least one material ad set in Meta's LEARNING / learning-limited state, so
   * any learning-RESETTING action (`resetsLearningFor === "yes"` — e.g. add_creative,
   * refresh_creative, expand_targeting, restructure) is held as an `in_learning_phase`
   * watch, because Meta re-enters learning on a significant edit and the per-ad-set
   * signal is finer than the V1 campaign-level guard. This is the V2 reset-class
   * lockout on the live per-campaign path; the V1 `learningGuard.gate` stays as the
   * campaign-level backstop for everything else. `undefined` is treated as `false`
   * (back-compat with existing callers/tests).
   */
  learningPhaseActive?: boolean;
  /**
   * PR2 Gate-4: which tier the per-campaign `effectiveTarget` came from — the
   * campaign's own booking-calibrated CAC ("campaign", Tier-1) or the account
   * fallback ("account", Tier-2). Forwarded to applyTier so each surviving rec is
   * stamped for operator visibility. `undefined` ⇒ unstamped (back-compat).
   */
  targetSource?: TargetSource;
}

export interface CampaignDecisionResult {
  insights: InsightOutput[];
  watches: WatchOutput[];
  recommendations: RecommendationOutput[];
}

/**
 * Task 8 Step 4: the single rule for whether a campaign's learning phase is "active"
 * for the reset-class lockout — its learning state is `learning` or `learning_limited`.
 * Pure; lives here (with the lockout it feeds) so the live `audit-runner` seam derives
 * `learningPhaseActive` from the already-fetched `learningStatus.state` (no extra Graph
 * call). `getCampaignLearningData → deriveLearningPhase` already folds a material-child
 * ad-set in LEARNING into that state, so the `learning` arm is genuinely ad-set-granular.
 * NOTE: the live V1 `LearningPhaseGuard.check` only emits `learning`/`success`, so the
 * `learning_limited` arm is reachable today only via the eval's V2 classifier; it goes
 * live when the per-campaign path adopts V2 ad-set classification (Phase B+).
 */
export function deriveLearningPhaseActive(state: LearningPhaseStatus["state"]): boolean {
  return state === "learning" || state === "learning_limited";
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
      // Placeholder pending real per-entity active-day tenure (Phase B); today
      // only `clicks`/`conversions` actually gate the evidence floor.
      days: 7,
    },
  });

  for (const item of campaignRecs) {
    // Gate 2 abstentions arrive as watches straight from the engine.
    // Fill checkBackDate here (not in the engine, which has no nextCycleDate).
    if (item.type === "watch") {
      watches.push({ ...item, checkBackDate: item.checkBackDate || input.nextCycleDate });
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
      input.revenueState.measurementTrusted === false &&
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
      marginBasis: input.revenueState.marginBasis ?? "unavailable",
      checkBackDate: input.nextCycleDate,
      ...(input.targetSource ? { targetSource: input.targetSource } : {}),
    });
    if (tiered.watch) {
      watches.push(tiered.watch);
      continue;
    }
    // V2 reset-class lockout (Task 8 Step 4): `learningPhaseActive` is true when a
    // material ad set in this campaign is in learning or learning-limited. In that case,
    // hold any learning-RESETTING ("yes"-class) action — Meta re-enters learning on a
    // significant edit, which would discard the in-progress learning. This targets the
    // reset class specifically; the V1 `learningGuard.gate` below is a state-based hold
    // (it holds while `learningStatus.state === "learning"`) and stays as the backstop.
    const tieredRec = tiered.recommendation!;
    if (input.learningPhaseActive && resetsLearningFor(tieredRec.action) === "yes") {
      watches.push({
        type: "watch",
        campaignId: tieredRec.campaignId,
        campaignName: tieredRec.campaignName,
        pattern: "in_learning_phase",
        message: `Holding "${tieredRec.action}": a material ad set in this campaign is still in learning, and this change would reset Meta's learning phase. Re-checking next cycle.`,
        checkBackDate: input.nextCycleDate,
      });
      continue;
    }
    const gated = learningGuard.gate(tieredRec, input.learningStatus);
    if (gated.type === "watch") watches.push(gated);
    else recommendations.push(gated);
  }

  return { insights, watches, recommendations };
}
