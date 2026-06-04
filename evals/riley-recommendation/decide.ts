import {
  assembleRevenueState,
  decideForCampaign,
  deriveLearningPhaseActive,
  LearningPhaseGuardV2,
  resolveEconomicTargetForCampaign,
} from "@switchboard/ad-optimizer";
import type { RileyCase } from "./schema.js";
import type {
  CampaignInsightSchema,
  LearningPhaseStatusSchema,
  TargetSourceSchema as TargetSource,
} from "@switchboard/schemas";

const v2 = new LearningPhaseGuardV2();

function insight(
  m: RileyCase["current"],
  campaignId = "c1",
  campaignName = "C1",
): CampaignInsightSchema {
  return {
    campaignId,
    campaignName,
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: m.impressions,
    inlineLinkClicks: m.inlineLinkClicks,
    spend: m.spend,
    conversions: m.conversions,
    revenue: m.revenue,
    frequency: m.frequency,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
  };
}

function statusFor(state: RileyCase["learningState"]): LearningPhaseStatusSchema {
  return v2.classifyState({
    adSetId: "a1",
    adSetName: "A1",
    campaignId: "c1",
    learningStageStatus:
      state === "learning"
        ? "LEARNING"
        : state === "learning_limited"
          ? "FAIL"
          : state === "success"
            ? "SUCCESS"
            : "UNKNOWN",
    frequency: 1,
    spend: 100,
    conversions: 10,
    cpa: 10,
    roas: 3,
    inlineLinkClickCtr: 1,
  });
}

/**
 * Structured decision result for a single Riley case. The `primary` label is the
 * back-compat reduced assertion (recommendation action > `watch` > `insight` >
 * `none`); the `actions`/`watchPatterns` SETS let a fixture pin that a specific
 * outcome is *among* what the engine produces — e.g. that a durable-breach case
 * emits BOTH `add_creative` AND `pause`, so a silently-dropped `pause` regression
 * fails the eval rather than slipping past a single-label reduction.
 */
export interface RileyDecision {
  /** All recommendation actions the engine produced, sorted (deduped). */
  actions: string[];
  /** All watch patterns the engine produced, sorted (deduped). */
  watchPatterns: string[];
  /** True when the engine emitted at least one stable `insight`. */
  hasInsight: boolean;
  /** Back-compat reduced label: recommendation action > `watch` > `insight` > `none`. */
  primary: string;
  /** PR2 Gate-4: the resolved per-campaign target source when the case carries a
   * `hybrid` block (campaign Tier-1 vs account Tier-2); undefined otherwise. */
  targetSource?: TargetSource;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** The decision-relevant subset of a fixture case (the arbitration eval reuses it
 * with eval-only fields stripped). */
export type RileyDecisionInputCase = Pick<
  RileyCase,
  | "current"
  | "previous"
  | "targetBreach"
  | "learningState"
  | "economicTier"
  | "effectiveTarget"
  | "targetROAS"
  | "measurementTrusted"
  | "hybrid"
>;

export interface RileyRawDecision {
  recommendations: ReturnType<typeof decideForCampaign>["recommendations"];
  watches: ReturnType<typeof decideForCampaign>["watches"];
  insights: ReturnType<typeof decideForCampaign>["insights"];
  targetSource?: TargetSource;
}

/**
 * Resolve a case through the REAL decideForCampaign pipeline and return the RAW
 * outputs (the arbitration eval feeds them to arbitrate(); decideForCase reduces
 * them to the per-campaign assertion surfaces). campaignId/campaignName are
 * parameterizable because a multi-campaign arbitration account needs distinct ids.
 * Deterministic, model-free, DB-free: the engine is the source of truth, and this
 * never re-implements any decision logic.
 */
export function decideRawForCase(
  c: RileyDecisionInputCase,
  campaignId = "c1",
  campaignName = "C1",
): RileyRawDecision {
  // PR2 Gate-4: when a fixture carries a `hybrid` block, resolve the per-campaign
  // economic target through the REAL resolver (Tier-1 campaign vs Tier-2 account)
  // and feed THAT into decideForCampaign — the exact live audit-runner seam. A
  // non-hybrid case pins the flat economicTier/effectiveTarget directly.
  let economicTier = c.economicTier;
  let effectiveTarget = c.effectiveTarget;
  let targetSource: TargetSource | undefined;
  if (c.hybrid) {
    const resolved = resolveEconomicTargetForCampaign({
      campaignBookings: c.hybrid.campaignBookings,
      campaignConversions: c.hybrid.campaignConversions,
      ...(c.hybrid.targetCostPerBooked !== undefined
        ? { targetCostPerBooked: c.hybrid.targetCostPerBooked }
        : {}),
      accountTarget: c.hybrid.accountTarget,
    });
    economicTier = resolved.economicTier;
    effectiveTarget = resolved.effectiveTarget;
    targetSource = resolved.targetSource;
  }

  const r = decideForCampaign({
    campaignId,
    campaignName,
    currentInsight: insight(c.current, campaignId, campaignName),
    previousInsight: c.previous ? insight(c.previous, campaignId, campaignName) : null,
    targetBreach: { ...c.targetBreach, isApproximate: c.targetBreach.granularity === "weekly" },
    learningStatus: statusFor(c.learningState),
    economicTier,
    effectiveTarget,
    // Account-level pre-flight signals (Riley v3 slice 1). The per-campaign economicTier/
    // effectiveTarget above stay separate (resolved per-campaign for hybrid cases).
    revenueState: assembleRevenueState({
      measurementTrusted: c.measurementTrusted ?? true,
      marginBasis: "unavailable",
      economicTier,
      effectiveTarget,
    }),
    targetROAS: c.targetROAS,
    nextCycleDate: "2026-05-14",
    // Task 8 Step 4: exercise the V2 reset-class lockout via the SAME rule the live
    // runner uses (deriveLearningPhaseActive), so the eval and audit-runner never drift.
    learningPhaseActive: deriveLearningPhaseActive(c.learningState),
    ...(targetSource ? { targetSource } : {}),
  });

  return {
    recommendations: r.recommendations,
    watches: r.watches,
    insights: r.insights,
    ...(targetSource ? { targetSource } : {}),
  };
}

/**
 * Resolve a fixture case through the REAL `decideForCampaign` pipeline and expose
 * both the full action/watch surfaces and the single reduced label (delegates to
 * decideRawForCase; behavior unchanged).
 */
export function decideForCase(c: RileyCase): RileyDecision {
  const raw = decideRawForCase(c);

  const actions = sortedUnique(raw.recommendations.map((rec) => rec.action));
  const watchPatterns = sortedUnique(raw.watches.map((w) => w.pattern));
  const hasInsight = raw.insights.length > 0;

  const primary =
    raw.recommendations.length > 0
      ? raw.recommendations[0]!.action
      : raw.watches.length > 0
        ? "watch"
        : raw.insights.length > 0
          ? "insight"
          : "none";

  return { actions, watchPatterns, hasInsight, primary, targetSource: raw.targetSource };
}
