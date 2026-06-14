import { describe, it, expect } from "vitest";
import { decideForCampaign } from "./campaign-decision.js";
import { assembleRevenueState } from "./revenue-state.js";
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
      revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
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
      revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
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
      revenueState: assembleRevenueState({ measurementTrusted: false, marginBasis: "unavailable" }),
      targetROAS: 3,
      nextCycleDate: "2026-05-14",
    });
    expect(r.recommendations.some((x) => x.action === "pause")).toBe(false);
    expect(r.watches.some((w) => w.pattern === "measurement_untrusted")).toBe(true);
  });

  describe("V2 reset-class lockout (learningPhaseActive)", () => {
    // CPA = 2100/7 = 300 = 3x the 100 target, daily breach >= KILL_DAYS_THRESHOLD (7),
    // and evidence floor met (200 clicks / 7 conversions) → the engine emits a
    // reset-class `add_creative` recommendation (and a `pause`). Learning status is a
    // SUCCESS state so the V1 campaign-level gate would NOT hold anything — isolating
    // the V2 ad-set-granular reset-class lockout, which keys off `learningPhaseActive`.
    const resetClassInputs = {
      campaignId: "c1",
      campaignName: "C1",
      currentInsight: insight({ spend: 2100, conversions: 7 }),
      previousInsight: insight({ spend: 2100, conversions: 7 }),
      targetBreach: { periodsAboveTarget: 9, granularity: "daily" as const, isApproximate: false },
      learningStatus: successStatus,
      economicTier: "cpl" as const,
      effectiveTarget: 100,
      revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
      targetROAS: 3,
      nextCycleDate: "2026-05-14",
    };

    it("converts a resetsLearning:'yes' action to an in_learning_phase watch when learningPhaseActive (V1 not holding)", () => {
      const r = decideForCampaign({ ...resetClassInputs, learningPhaseActive: true });
      // The reset-class action is held by V2 as an in_learning_phase watch...
      expect(r.recommendations.some((x) => x.action === "add_creative")).toBe(false);
      const watch = r.watches.find((w) => w.pattern === "in_learning_phase");
      expect(watch).toBeDefined();
      expect(watch?.message).toContain("add_creative");
      expect(watch?.checkBackDate).toBe("2026-05-14");
    });

    it("does NOT convert the action when learningPhaseActive is false (flows past V2 to recommendation/V1)", () => {
      const r = decideForCampaign({ ...resetClassInputs, learningPhaseActive: false });
      // With learning inactive AND a SUCCESS learning status, V2 does not fire and V1
      // does not hold: the reset-class action reaches a recommendation, and there is no
      // in_learning_phase watch from this seam.
      expect(r.recommendations.some((x) => x.action === "add_creative")).toBe(true);
      expect(r.watches.some((w) => w.pattern === "in_learning_phase")).toBe(false);
    });

    it("treats undefined learningPhaseActive as false (back-compat with existing callers)", () => {
      const r = decideForCampaign(resetClassInputs);
      expect(r.recommendations.some((x) => x.action === "add_creative")).toBe(true);
      expect(r.watches.some((w) => w.pattern === "in_learning_phase")).toBe(false);
    });
  });

  describe("zero-conversion burn (D1-1)", () => {
    // A campaign spending $2100 with ZERO attributed conversions and 600 clicks, with a
    // durable daily breach already accrued. cpa = safeDivide(2100, 0) = 0.
    const burnInsight = insight({ spend: 2100, conversions: 0, inlineLinkClicks: 600, revenue: 0 });
    const durableDailyBreach = {
      periodsAboveTarget: 14,
      granularity: "daily" as const,
      isApproximate: false,
    };

    it("never emits a positive 'maintained ROAS' insight on a zero-conversion burn (targetROAS=0)", () => {
      // targetROAS:0 is the ONLY condition under which isPerformingWell returns true at
      // cpa=0 (0<=target AND 0>=0). PRE-FIX the engine emitted a positive
      // "maintained 0.0x ROAS" stable_performance insight and returned early.
      const r = decideForCampaign({
        campaignId: "c1",
        campaignName: "C1",
        currentInsight: burnInsight,
        previousInsight: burnInsight,
        targetBreach: durableDailyBreach,
        learningStatus: successStatus,
        economicTier: "booked_cac",
        effectiveTarget: 100,
        revenueState: assembleRevenueState({
          measurementTrusted: true,
          marginBasis: "unavailable",
        }),
        targetROAS: 0,
        nextCycleDate: "2026-05-14",
      });
      // The stable-performance insight must NOT appear; the burn must surface instead.
      expect(r.insights.some((i) => i.category === "stable_performance")).toBe(false);
      expect(r.recommendations.length + r.watches.length).toBeGreaterThan(0);
    });

    it("routes a durable zero-conversion burn to a pause recommendation (targetROAS=3, not silent)", () => {
      const r = decideForCampaign({
        campaignId: "c1",
        campaignName: "C1",
        currentInsight: burnInsight,
        previousInsight: burnInsight,
        targetBreach: durableDailyBreach,
        learningStatus: successStatus,
        economicTier: "booked_cac",
        effectiveTarget: 100,
        revenueState: assembleRevenueState({
          measurementTrusted: true,
          marginBasis: "unavailable",
        }),
        targetROAS: 3,
        nextCycleDate: "2026-05-14",
      });
      expect(r.recommendations.some((x) => x.action === "pause")).toBe(true);
      expect(r.insights).toHaveLength(0);
    });

    it("holds the zero-conversion burn as a measurement_untrusted watch when the denominator is untrusted", () => {
      // The pause is a destructive rec, so the existing Gate-1 measurement-trust hold
      // still demotes it when an account-wide conversion-reporting shift is suspected —
      // the right safety valve for "the zero might be attribution blindness".
      const r = decideForCampaign({
        campaignId: "c1",
        campaignName: "C1",
        currentInsight: burnInsight,
        previousInsight: burnInsight,
        targetBreach: durableDailyBreach,
        learningStatus: successStatus,
        economicTier: "booked_cac",
        effectiveTarget: 100,
        revenueState: assembleRevenueState({
          measurementTrusted: false,
          marginBasis: "unavailable",
        }),
        targetROAS: 3,
        nextCycleDate: "2026-05-14",
      });
      expect(r.recommendations.some((x) => x.action === "pause")).toBe(false);
      expect(r.watches.some((w) => w.pattern === "measurement_untrusted")).toBe(true);
    });
  });

  it("stamps checkBackDate on engine-emitted insufficient_evidence watch from nextCycleDate", () => {
    // Sub-floor evidence (2 clicks, 0 conversions) means the destructive-family
    // add_creative recommendation is demoted by Gate 2 to an insufficient_evidence
    // watch inside the engine. Campaign decision's passthrough branch must fill
    // checkBackDate from input.nextCycleDate (was always empty string "").
    const r = decideForCampaign({
      campaignId: "c1",
      campaignName: "C1",
      // CPA = 2100/7 = 300 = 3x target → above add_creative 2x threshold + 9 breach days ≥ 7
      currentInsight: insight({ spend: 2100, conversions: 7, inlineLinkClicks: 2 }),
      previousInsight: insight({ spend: 2100, conversions: 7, inlineLinkClicks: 2 }),
      targetBreach: { periodsAboveTarget: 9, granularity: "daily" as const, isApproximate: false },
      learningStatus: successStatus,
      economicTier: "cpl",
      effectiveTarget: 100,
      revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
      targetROAS: 3,
      nextCycleDate: "2026-05-21",
    });
    const w = r.watches.find((x) => x.pattern === "insufficient_evidence");
    expect(w).toBeDefined();
    expect(w?.checkBackDate).toBe("2026-05-21");
  });
});

describe("decideForCampaign targetSource (PR2 Gate-4)", () => {
  it("stamps targetSource onto every produced recommendation when provided", () => {
    const r = decideForCampaign({
      campaignId: "c1",
      campaignName: "C1",
      currentInsight: insight({ spend: 2800, conversions: 8 }),
      previousInsight: insight({ spend: 2800, conversions: 8 }),
      targetBreach: { periodsAboveTarget: 8, granularity: "daily", isApproximate: false },
      learningStatus: successStatus,
      economicTier: "booked_cac",
      effectiveTarget: 100,
      revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
      targetROAS: 3,
      nextCycleDate: "2026-05-14",
      targetSource: "campaign",
    });
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.every((rec) => rec.targetSource === "campaign")).toBe(true);
  });

  it("leaves targetSource unstamped when not provided (back-compat)", () => {
    const r = decideForCampaign({
      campaignId: "c1",
      campaignName: "C1",
      currentInsight: insight({ spend: 2800, conversions: 8 }),
      previousInsight: insight({ spend: 2800, conversions: 8 }),
      targetBreach: { periodsAboveTarget: 8, granularity: "daily", isApproximate: false },
      learningStatus: successStatus,
      economicTier: "booked_cac",
      effectiveTarget: 100,
      revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
      targetROAS: 3,
      nextCycleDate: "2026-05-14",
    });
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.every((rec) => rec.targetSource === undefined)).toBe(true);
  });
});
