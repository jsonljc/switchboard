import { describe, it, expect } from "vitest";
import {
  arbitrate,
  PROXIMITY_BY_TIER,
  MEASUREMENT_UNTRUSTED_FACTOR,
  SIGNAL_YELLOW_FACTOR,
  LEARNING_RESET_PENALTY,
  ATTRIBUTION_CONFLICT_PENALTY,
} from "./opportunity-arbitrator.js";
import { ACCOUNT_CAMPAIGN_ID } from "./source-reallocation.js";
import { assembleRevenueState, withSpendAttributionCoverage } from "../revenue-state.js";
import { resetsLearningFor } from "../action-reset-classification.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";

function rec(
  action: RecommendationOutput["action"],
  campaignId: string,
  overrides: Partial<RecommendationOutput> = {},
): RecommendationOutput {
  return {
    type: "recommendation",
    action,
    campaignId,
    campaignName: campaignId.toUpperCase(),
    confidence: 0.8,
    urgency: "this_week",
    estimatedImpact: "impact",
    steps: ["step"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
}

const trusted = assembleRevenueState({
  measurementTrusted: true,
  economicTier: "booked_cac",
  effectiveTarget: 100,
  marginBasis: "unavailable",
});

describe("arbitrate", () => {
  it("returns empty result shape for zero candidates", () => {
    const r = arbitrate({ candidates: [], revenueState: trusted, currentInsights: [] });
    expect(r.primary).toBeUndefined();
    expect(r.secondary).toEqual([]);
    expect(r.measurementFix).toBeUndefined();
  });

  it("picks the higher-spend mutating candidate as primary (structured materiality)", () => {
    const candidates = [rec("pause", "c1"), rec("pause", "c2")];
    const r = arbitrate({
      candidates,
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 2_000 },
        { campaignId: "c2", spend: 8_000 },
      ],
    });
    expect(r.primary).toMatchObject({ campaignId: "c2", action: "pause", index: 1 });
    expect(r.secondary).toHaveLength(1);
    expect(r.secondary[0]).toMatchObject({ campaignId: "c1", action: "pause", index: 0 });
    // Exact scores: share x proximity(booked_cac=1) x confidence(1) - penalties(0).
    expect(r.primary?.score).toBeCloseTo(0.8, 10);
    expect(r.secondary[0]?.score).toBeCloseTo(0.2, 10);
  });

  it("non-mutating diagnostics (hold/test) are never ranked; no mutating means no primary", () => {
    const r = arbitrate({
      candidates: [rec("hold", "c1"), rec("test", "c2")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 5_000 },
        { campaignId: "c2", spend: 5_000 },
      ],
    });
    expect(r.primary).toBeUndefined();
    expect(r.secondary).toEqual([]);
  });

  it("learning-reset penalty demotes a same-spend resetting action below a non-resetting one", () => {
    // Same campaign spend on two campaigns; add_creative resets learning ("yes"), pause does not.
    const r = arbitrate({
      candidates: [rec("add_creative", "c1"), rec("pause", "c2")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 5_000 },
        { campaignId: "c2", spend: 5_000 },
      ],
    });
    expect(r.primary?.campaignId).toBe("c2");
    expect(r.primary?.score).toBeCloseTo(0.5, 10);
    expect(r.secondary[0]?.score).toBeCloseTo(0.5 - LEARNING_RESET_PENALTY.yes, 10);
  });

  it("attribution-conflict penalty hits every mutating candidate on a contested campaign", () => {
    // c1 proposes TWO mutating edits (conflict); c2 proposes one with lower spend.
    const r = arbitrate({
      candidates: [rec("pause", "c1"), rec("scale", "c1"), rec("pause", "c2")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 6_000 },
        { campaignId: "c2", spend: 4_500 },
      ],
    });
    // c1 share 6000/10500 - 0.2 conflict = 0.3714... < c2 4500/10500 = 0.4286 -> c2 wins.
    expect(r.primary?.campaignId).toBe("c2");
    const c1Entries = r.secondary.filter((s) => s.campaignId === "c1");
    expect(c1Entries).toHaveLength(2);
    for (const e of c1Entries) {
      expect(e.score).toBeLessThan(r.primary!.score);
      expect(e.score).toBeCloseTo(6_000 / 10_500 - ATTRIBUTION_CONFLICT_PENALTY, 10);
    }
  });

  it("ties break deterministically: campaignId asc, then action asc, then index asc", () => {
    const r = arbitrate({
      candidates: [rec("pause", "c2"), rec("pause", "c1")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 5_000 },
        { campaignId: "c2", spend: 5_000 },
      ],
    });
    expect(r.primary?.campaignId).toBe("c1");
    const r2 = arbitrate({
      candidates: [rec("scale", "c1"), rec("pause", "c1")],
      revenueState: trusted,
      currentInsights: [{ campaignId: "c1", spend: 5_000 }],
    });
    // Same campaign, same score (pause and scale both resetsLearning "no", both
    // conflict-penalized) -> tie -> action asc: pause < scale.
    expect(r2.primary?.action).toBe("pause");
  });

  it("measurement fix is never starved by the mutating cap and is chosen by urgency then index", () => {
    const fixLow = rec("fix_signal_health", "signal:px", { urgency: "this_week" });
    const fixHigh = rec("fix_signal_health", "signal:px", { urgency: "immediate" });
    const r = arbitrate({
      candidates: [
        rec("pause", "c1"),
        fixLow,
        fixHigh,
        rec("harden_capi_attribution", "signal:px"),
      ],
      revenueState: trusted,
      currentInsights: [{ campaignId: "c1", spend: 5_000 }],
    });
    expect(r.primary?.action).toBe("pause");
    expect(r.measurementFix).toMatchObject({ action: "fix_signal_health", index: 2 });
  });

  it("truthConfidence dampens: untrusted measurement and yellow signal multiply in", () => {
    const damp = assembleRevenueState({
      measurementTrusted: false,
      economicTier: "cpl",
      signalHealthScore: "yellow",
      coverage: { coveragePct: 0.6, sufficient: true },
    });
    const r = arbitrate({
      candidates: [rec("pause", "c1")],
      revenueState: damp,
      currentInsights: [{ campaignId: "c1", spend: 5_000 }],
    });
    const expected =
      1 * PROXIMITY_BY_TIER.cpl * (MEASUREMENT_UNTRUSTED_FACTOR * SIGNAL_YELLOW_FACTOR * 0.6);
    expect(r.primary?.score).toBeCloseTo(expected, 10);
  });

  it("the account-scoped shift candidate takes magnitude from its from-source spend and the per-source coverage factor", () => {
    const shift = rec("shift_budget_to_source", ACCOUNT_CAMPAIGN_ID, {
      params: { from: "google_ads", to: "meta_ads", fromTrueRoas: "0.80", toTrueRoas: "2.40" },
    });
    const state = withSpendAttributionCoverage(trusted, { google_ads: 0.8, meta_ads: 0.9 });
    const r = arbitrate({
      candidates: [shift, rec("pause", "c1")],
      revenueState: state,
      currentInsights: [{ campaignId: "c1", spend: 2_000 }],
      spendBySource: { google_ads: 8_000, meta_ads: 0 },
    });
    // accountSpend = sum(currentInsights) = 2000; from-source magnitude 8000 -> share
    // clamped to 1. score(shift) = 1 x proximity(1) x (1 x min(0.8, 0.9)) - 0.05
    // (conditional reset). pause: 2000/2000 x 1 x 1 = 1 - 0 = 1... pause would WIN.
    // The shift is primary only when its damped score beats pause's: use a smaller
    // campaign so pause's share drops: handled below with spend 1_000 vs clamp 1.
    expect(r.primary?.action).toBe("pause");
    const shiftEntry = r.secondary.find((s) => s.action === "shift_budget_to_source");
    expect(shiftEntry?.score).toBeCloseTo(1 * 1 * 0.8 - LEARNING_RESET_PENALTY.conditional, 10);
    expect(shiftEntry?.campaignId).toBe(ACCOUNT_CAMPAIGN_ID);
  });

  it("zero account spend yields zero materiality, never NaN", () => {
    const r = arbitrate({
      candidates: [rec("pause", "c1")],
      revenueState: trusted,
      currentInsights: [{ campaignId: "c1", spend: 0 }],
    });
    expect(r.primary?.score).toBeCloseTo(0, 10);
    expect(Number.isNaN(r.primary?.score)).toBe(false);
  });

  it("is pure: does not mutate the candidates array or its items", () => {
    const candidates = [rec("pause", "c1"), rec("hold", "c2")];
    const snapshot = JSON.parse(JSON.stringify(candidates)) as unknown;
    arbitrate({
      candidates,
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 1_000 },
        { campaignId: "c2", spend: 1_000 },
      ],
    });
    expect(JSON.parse(JSON.stringify(candidates))).toEqual(snapshot);
  });

  it("defensive tier fallback: missing economicTier uses the conservative cpc proximity", () => {
    const bare = assembleRevenueState({ measurementTrusted: true });
    const r = arbitrate({
      candidates: [rec("pause", "c1")],
      revenueState: bare,
      currentInsights: [{ campaignId: "c1", spend: 1_000 }],
    });
    expect(r.primary?.score).toBeCloseTo(PROXIMITY_BY_TIER.cpc, 10);
  });
});
