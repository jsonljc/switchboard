import { describe, it, expect } from "vitest";
import { decideForCampaign } from "./campaign-decision.js";
import { LearningPhaseGuard } from "./learning-phase-guard.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

const guard = new LearningPhaseGuard();
const successStatus = guard.check("c1", {
  effectiveStatus: "ACTIVE",
  learningPhase: false,
  lastModifiedDays: 30,
  optimizationEvents: 100,
});

function insight(over: Partial<CampaignInsight>): CampaignInsight {
  return {
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 10000,
    inlineLinkClicks: 200,
    spend: 100,
    conversions: 10,
    revenue: 500,
    frequency: 1.5,
    cpm: 10,
    inlineLinkClickCtr: 2,
    costPerInlineLinkClick: 0.5,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...over,
  };
}

describe("decideForCampaign (characterization)", () => {
  it("a healthy under-target campaign with no diagnoses yields a stable insight", () => {
    const r = decideForCampaign({
      campaignId: "c1",
      campaignName: "C1",
      currentInsight: insight({ spend: 50, conversions: 10, revenue: 600 }),
      previousInsight: insight({ spend: 50, conversions: 10, revenue: 600 }),
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      learningStatus: successStatus,
      economicTier: "cpl",
      effectiveTarget: 100,
      marginBasis: "unavailable",
      targetROAS: 3,
      nextCycleDate: "2026-05-14",
    });
    expect(r.insights).toHaveLength(1);
    expect(r.recommendations).toHaveLength(0);
  });

  it("a 3x-over campaign with a durable breach yields a pause recommendation", () => {
    // CPA = 2800/8 = 350 = 3.5x the 100 target. conversions 8 >= destructive
    // floor 5 and inlineLinkClicks 200 (default) >= 50, so the evidence floor
    // (Gate 2) is met and the pause is NOT demoted to an abstention watch.
    const r = decideForCampaign({
      campaignId: "c1",
      campaignName: "C1",
      currentInsight: insight({ spend: 2800, conversions: 8 }),
      previousInsight: insight({ spend: 2800, conversions: 8 }),
      targetBreach: { periodsAboveTarget: 8, granularity: "daily", isApproximate: false },
      learningStatus: successStatus,
      economicTier: "booked_cac",
      effectiveTarget: 100,
      marginBasis: "unavailable",
      targetROAS: 3,
      nextCycleDate: "2026-05-14",
    });
    expect(r.recommendations.some((x) => x.action === "pause")).toBe(true);
  });

  it("holds the same pause-worthy campaign as a watch when measurementTrusted is false", () => {
    // Identical to the pause case above (sufficient evidence, durable breach,
    // success learning) — the ONLY change is measurementTrusted:false, which
    // makes the account-wide cost signal untrustworthy this cycle. The pause is
    // demoted to a measurement_untrusted watch instead of being recommended.
    const r = decideForCampaign({
      campaignId: "c1",
      campaignName: "C1",
      currentInsight: insight({ spend: 2800, conversions: 8 }),
      previousInsight: insight({ spend: 2800, conversions: 8 }),
      targetBreach: { periodsAboveTarget: 8, granularity: "daily", isApproximate: false },
      learningStatus: successStatus,
      economicTier: "booked_cac",
      effectiveTarget: 100,
      marginBasis: "unavailable",
      targetROAS: 3,
      nextCycleDate: "2026-05-14",
      measurementTrusted: false,
    });
    expect(r.recommendations.some((x) => x.action === "pause")).toBe(false);
    expect(r.watches.some((w) => w.pattern === "measurement_untrusted")).toBe(true);
  });
});
