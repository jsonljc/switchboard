import {
  decideForCampaign,
  deriveLearningPhaseActive,
  LearningPhaseGuardV2,
} from "@switchboard/ad-optimizer";
import type { RileyCase } from "./schema.js";
import type { CampaignInsightSchema, LearningPhaseStatusSchema } from "@switchboard/schemas";

const v2 = new LearningPhaseGuardV2();

function insight(m: RileyCase["current"]): CampaignInsightSchema {
  return {
    campaignId: "c1",
    campaignName: "C1",
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
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Resolve a fixture case through the REAL `decideForCampaign` pipeline and expose
 * both the full action/watch surfaces and the single reduced label. Deterministic,
 * model-free, DB-free — the engine is the source of truth; this never re-implements
 * any decision logic.
 */
export function decideForCase(c: RileyCase): RileyDecision {
  const r = decideForCampaign({
    campaignId: "c1",
    campaignName: "C1",
    currentInsight: insight(c.current),
    previousInsight: c.previous ? insight(c.previous) : null,
    targetBreach: { ...c.targetBreach, isApproximate: c.targetBreach.granularity === "weekly" },
    learningStatus: statusFor(c.learningState),
    economicTier: c.economicTier,
    effectiveTarget: c.effectiveTarget,
    marginBasis: "unavailable",
    targetROAS: c.targetROAS,
    nextCycleDate: "2026-05-14",
    measurementTrusted: c.measurementTrusted ?? true,
    // Task 8 Step 4: exercise the V2 reset-class lockout via the SAME rule the live
    // runner uses (deriveLearningPhaseActive), so the eval and audit-runner never drift.
    learningPhaseActive: deriveLearningPhaseActive(c.learningState),
  });

  const actions = sortedUnique(r.recommendations.map((rec) => rec.action));
  const watchPatterns = sortedUnique(r.watches.map((w) => w.pattern));
  const hasInsight = r.insights.length > 0;

  const primary =
    r.recommendations.length > 0
      ? r.recommendations[0]!.action
      : r.watches.length > 0
        ? "watch"
        : r.insights.length > 0
          ? "insight"
          : "none";

  return { actions, watchPatterns, hasInsight, primary };
}
