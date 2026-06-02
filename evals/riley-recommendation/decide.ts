import { decideForCampaign, LearningPhaseGuardV2 } from "@switchboard/ad-optimizer";
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

/** Reduce a decision to a single label for assertion. Priority: recommendation
 * action > watch > insight. */
export function decideForCase(c: RileyCase): string {
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
  });
  if (r.recommendations.length > 0) return r.recommendations[0]!.action;
  if (r.watches.length > 0) return "watch";
  if (r.insights.length > 0) return "insight";
  return "none";
}
