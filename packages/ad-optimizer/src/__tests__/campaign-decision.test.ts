import { describe, it, expect } from "vitest";
import { decideForCampaign, type CampaignDecisionInput } from "../campaign-decision.js";
import { assembleRevenueState } from "../revenue-state.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  LearningPhaseStatusSchema as LearningPhaseStatus,
} from "@switchboard/schemas";

// A cheap-cost-per-lead campaign that, absent the A12 gate, produces exactly a `scale` rec:
// cpa = 2000/40 = 50 < 0.8 * effectiveTarget(100) = 80 (scale rule), and roas = 0/2000 = 0 <
// targetROAS(3) so isPerformingWell is false (no early "performing well" insight return). Identical
// previous insight => no diagnoses; periodsAboveTarget 0; success learning => the ONLY rec is scale.
function insight(over: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 40000,
    inlineLinkClicks: 800,
    spend: 2000,
    conversions: 40,
    revenue: 0,
    frequency: 1.5,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...over,
  };
}

const successStatus: LearningPhaseStatus = {
  adSetId: "a1",
  adSetName: "A1",
  campaignId: "c1",
  state: "success",
  metricsSnapshot: null,
  postExitSnapshot: null,
  exitStability: null,
};

function baseInput(over: Partial<CampaignDecisionInput> = {}): CampaignDecisionInput {
  return {
    campaignId: "c1",
    campaignName: "C1",
    currentInsight: insight(),
    previousInsight: insight(),
    targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
    learningStatus: successStatus,
    economicTier: "booked_cac",
    effectiveTarget: 100,
    revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
    targetROAS: 3,
    nextCycleDate: "2026-05-14",
    learningPhaseActive: false,
    ...over,
  };
}

describe("decideForCampaign A12 count-vs-value gate", () => {
  it("emits scale with NO paidValueGate (gate opt-in, back-compat)", () => {
    const r = decideForCampaign(baseInput());
    expect(r.recommendations.map((x) => x.action)).toContain("scale");
    expect(r.watches.map((w) => w.pattern)).not.toContain("scale_unproven_paid_value");
  });

  it("demotes scale to a watch when paid value is absent (fail-closed)", () => {
    const r = decideForCampaign(baseInput({ paidValueGate: { paidValueCents: null } }));
    expect(r.recommendations.map((x) => x.action)).not.toContain("scale");
    expect(r.watches.map((w) => w.pattern)).toContain("scale_unproven_paid_value");
    expect(r.watches.find((w) => w.pattern === "scale_unproven_paid_value")?.checkBackDate).toBe(
      "2026-05-14",
    );
  });

  it("demotes scale on zero and on NaN paid value (fail-closed)", () => {
    for (const paidValueCents of [0, Number.NaN]) {
      const r = decideForCampaign(baseInput({ paidValueGate: { paidValueCents } }));
      expect(r.recommendations.map((x) => x.action)).not.toContain("scale");
      expect(r.watches.map((w) => w.pattern)).toContain("scale_unproven_paid_value");
    }
  });

  it("lets scale flow when paid value is proven (finite positive)", () => {
    const r = decideForCampaign(baseInput({ paidValueGate: { paidValueCents: 50000 } }));
    expect(r.recommendations.map((x) => x.action)).toContain("scale");
    expect(r.watches.map((w) => w.pattern)).not.toContain("scale_unproven_paid_value");
  });
});
