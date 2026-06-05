// packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts
import { describe, it, expect } from "vitest";
import { generateRecommendations } from "../recommendation-engine.js";
import type { RecommendationInput } from "../recommendation-engine.js";
import type { Diagnosis } from "../metric-diagnostician.js";
import type {
  MetricDeltaSchema as MetricDelta,
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";

/** Narrow the engine's `(RecommendationOutput | WatchOutput)[]` to just the
 * recommendations. These cases all supply generous evidence so the Gate-2
 * evidence floor never demotes a rec to a watch — the prior assertions hold. */
function recs(result: (RecommendationOutput | WatchOutput)[]): RecommendationOutput[] {
  return result.filter((r): r is RecommendationOutput => r.type === "recommendation");
}

function makeDelta(
  metric: string,
  current: number,
  previous: number,
  direction: "up" | "down" | "stable",
  significant: boolean,
): MetricDelta {
  const deltaPercent = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  return { metric, current, previous, deltaPercent, direction, significant };
}

function makeDiagnosis(pattern: string): Diagnosis {
  return { pattern, description: `${pattern} description`, confidence: "high" };
}

describe("generateRecommendations", () => {
  it("generates add_creative recommendation when CPA > 2x targetCPA and daysAboveTarget >= 7", () => {
    const input: RecommendationInput = {
      campaignId: "camp-1",
      campaignName: "Test Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const addCreative = recs(result).find((r) => r.action === "add_creative");
    expect(addCreative).toBeDefined();
    expect(addCreative?.urgency).toBe("this_week");
    expect(addCreative?.confidence).toBe(0.8);
  });

  it("generates scale recommendation when CPA < 0.8x targetCPA, daysAboveTarget=0, no diagnoses", () => {
    const input: RecommendationInput = {
      campaignId: "camp-2",
      campaignName: "Scaling Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 50, 80, "down", true)],
      targetCPA: 80,
      targetROAS: 3,
      currentSpend: 1000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const scale = recs(result).find((r) => r.action === "scale");
    expect(scale).toBeDefined();
    expect(scale?.urgency).toBe("this_week");
  });

  it("generates refresh_creative recommendation when diagnosis includes creative_fatigue", () => {
    const input: RecommendationInput = {
      campaignId: "camp-3",
      campaignName: "Fatigued Campaign",
      diagnoses: [makeDiagnosis("creative_fatigue")],
      deltas: [makeDelta("cpa", 90, 80, "up", false)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const refresh = recs(result).find((r) => r.action === "refresh_creative");
    expect(refresh).toBeDefined();
    expect(refresh?.confidence).toBe(0.85);
    expect(refresh?.urgency).toBe("this_week");
  });

  it("scale steps mention 20% budget cap", () => {
    const input: RecommendationInput = {
      campaignId: "camp-4",
      campaignName: "Budget Cap Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 40, 80, "down", true)],
      targetCPA: 80,
      targetROAS: 3,
      currentSpend: 1000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const scale = recs(result).find((r) => r.action === "scale");
    expect(scale).toBeDefined();
    const stepsText = scale!.steps.join(" ");
    expect(stepsText).toContain("20%");
  });

  it("returns empty array for stable campaign (CPA=100, target=100, no diagnoses)", () => {
    const input: RecommendationInput = {
      campaignId: "camp-5",
      campaignName: "Stable Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 100, 100, "stable", false)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    expect(result).toEqual([]);
  });

  it("generates refresh_creative with confidence 0.7 for audience_saturation diagnosis", () => {
    const input: RecommendationInput = {
      campaignId: "camp-6",
      campaignName: "Saturated Campaign",
      diagnoses: [makeDiagnosis("audience_saturation")],
      deltas: [makeDelta("cpa", 90, 80, "up", false)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const refresh = recs(result).find((r) => r.action === "refresh_creative");
    expect(refresh).toBeDefined();
    expect(refresh?.confidence).toBe(0.7);
  });

  it("generates restructure recommendation for audience_saturation", () => {
    const input: RecommendationInput = {
      campaignId: "camp-7",
      campaignName: "Saturated Campaign",
      diagnoses: [makeDiagnosis("audience_saturation")],
      deltas: [makeDelta("cpa", 90, 80, "up", false)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const restructure = recs(result).find((r) => r.action === "restructure");
    expect(restructure).toBeDefined();
    expect(restructure?.confidence).toBe(0.65);
    expect(restructure?.urgency).toBe("next_cycle");
  });

  it("generates hold recommendation for landing_page_drop", () => {
    const input: RecommendationInput = {
      campaignId: "camp-8",
      campaignName: "LP Drop Campaign",
      diagnoses: [makeDiagnosis("landing_page_drop")],
      deltas: [makeDelta("cpa", 110, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2000,
      targetBreach: { periodsAboveTarget: 2, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const hold = recs(result).find((r) => r.action === "hold");
    expect(hold).toBeDefined();
    expect(hold?.confidence).toBe(0.75);
    expect(hold?.urgency).toBe("this_week");
  });

  it("does not generate add_creative when daysAboveTarget < 7", () => {
    const input: RecommendationInput = {
      campaignId: "camp-9",
      campaignName: "Not Dead Yet",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 5, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const addCreative = recs(result).find((r) => r.action === "add_creative");
    expect(addCreative).toBeUndefined();
  });

  it("does not generate scale when diagnoses exist", () => {
    const input: RecommendationInput = {
      campaignId: "camp-10",
      campaignName: "Diagnosed Campaign",
      diagnoses: [makeDiagnosis("creative_fatigue")],
      deltas: [makeDelta("cpa", 50, 80, "down", true)],
      targetCPA: 80,
      targetROAS: 3,
      currentSpend: 1000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const scale = recs(result).find((r) => r.action === "scale");
    expect(scale).toBeUndefined();
  });

  it("each recommendation has all required fields", () => {
    const input: RecommendationInput = {
      campaignId: "camp-11",
      campaignName: "Kill Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    expect(result.length).toBeGreaterThan(0);
    for (const rec of recs(result)) {
      expect(rec.type).toBe("recommendation");
      expect(rec.campaignId).toBe("camp-11");
      expect(rec.campaignName).toBe("Kill Campaign");
      expect(typeof rec.confidence).toBe("number");
      expect(rec.urgency).toBeDefined();
      expect(typeof rec.estimatedImpact).toBe("string");
      expect(Array.isArray(rec.steps)).toBe(true);
      expect(typeof rec.learningPhaseImpact).toBe("string");
    }
  });

  it("generates review_budget for weekly breach above kill CPA", () => {
    const input: RecommendationInput = {
      campaignId: "camp-weekly",
      campaignName: "Weekly Breach",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 1, granularity: "weekly", isApproximate: true },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const review = recs(result).find((r) => r.action === "review_budget");
    expect(review).toBeDefined();
    expect(review?.confidence).toBe(0.65);
  });

  it("does not generate add_creative for weekly breach", () => {
    const input: RecommendationInput = {
      campaignId: "camp-weekly-2",
      campaignName: "Weekly No Kill",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 7, granularity: "weekly", isApproximate: true },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const addCreative = recs(result).find((r) => r.action === "add_creative");
    expect(addCreative).toBeUndefined();
    const review = recs(result).find((r) => r.action === "review_budget");
    expect(review).toBeDefined();
  });

  it("generates add_creative instead of kill when CPA > 2x target (daily, 7+ days)", () => {
    const input: RecommendationInput = {
      campaignId: "camp-add-creative",
      campaignName: "Add Creative Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const addCreative = recs(result).find((r) => r.action === "add_creative");
    expect(addCreative).toBeDefined();
    const pause = recs(result).find((r) => r.action === "pause");
    expect(pause).toBeUndefined();
  });

  it("generates pause only when CPA > 3x target", () => {
    const input: RecommendationInput = {
      campaignId: "camp-pause",
      campaignName: "Extreme CPA Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 350, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const pause = recs(result).find((r) => r.action === "pause");
    expect(pause).toBeDefined();
    expect(pause?.urgency).toBe("immediate");
    expect(pause?.confidence).toBe(0.9);
  });

  it("recommends switch_optimization_event for CTWA optimizing on chats", () => {
    const input: RecommendationInput = {
      campaignId: "camp-ctwa",
      campaignName: "CTWA Campaign",
      diagnoses: [makeDiagnosis("ctwa_drive_by_clickers")],
      deltas: [],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    expect(recs(result).some((r) => r.action === "switch_optimization_event")).toBe(true);
  });

  it("emits harden_capi_attribution when capiAttributionStale flag is true", () => {
    const input: RecommendationInput = {
      campaignId: "camp-capi-stale",
      campaignName: "Stale CAPI",
      diagnoses: [],
      deltas: [],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
      capiAttributionStale: true,
    };

    const result = generateRecommendations(input);

    expect(recs(result).find((r) => r.action === "harden_capi_attribution")).toBeDefined();
  });

  it("does NOT emit harden_capi_attribution when capiAttributionStale is unset", () => {
    const input: RecommendationInput = {
      campaignId: "camp-capi-fresh",
      campaignName: "Fresh CAPI",
      diagnoses: [],
      deltas: [],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    expect(recs(result).find((r) => r.action === "harden_capi_attribution")).toBeUndefined();
  });

  it("adds learning phase reset warning to restructure recommendations", () => {
    const input: RecommendationInput = {
      campaignId: "camp-restructure",
      campaignName: "Restructure Campaign",
      diagnoses: [makeDiagnosis("audience_saturation")],
      deltas: [makeDelta("cpa", 90, 80, "up", false)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2000,
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      evidence: { clicks: 1000, conversions: 100, days: 7 },
    };

    const result = generateRecommendations(input);

    const restructure = recs(result).find((r) => r.action === "restructure");
    expect(restructure).toBeDefined();
    expect(restructure?.learningPhaseImpact).toBe("will reset learning");
  });

  describe("Gate-2 evidence-floor abstention (direct engine coverage)", () => {
    // CPA = 3x target + 9 daily breach days → the engine WOULD emit add_creative +
    // pause if evidence were sufficient. With only 8 clicks / 0 conversions (well
    // below destructive floor: 50 clicks / 5 conversions), Gate 2 demotes both to
    // insufficient_evidence watches. This test would vacuously pass if the floor
    // gating were removed — the assertion `not a destructive recommendation` is the
    // guard (it would flip to a real add_creative/pause, breaking the test).
    const subFloorInput: RecommendationInput = {
      campaignId: "camp-sub-floor",
      campaignName: "Thin Evidence Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 300, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2400,
      targetBreach: { periodsAboveTarget: 9, granularity: "daily", isApproximate: false },
      evidence: { clicks: 8, conversions: 0, days: 7 }, // sub-floor: clicks<50, conversions<5
    };

    it("emits an insufficient_evidence watch instead of destructive recs when evidence is below floor", () => {
      const result = generateRecommendations(subFloorInput);

      const watches = result.filter((r): r is WatchOutput => r.type === "watch");
      const insufficientEvidenceWatch = watches.find((w) => w.pattern === "insufficient_evidence");
      expect(insufficientEvidenceWatch).toBeDefined();
    });

    it("does NOT emit the destructive recommendation when evidence is below floor", () => {
      const result = generateRecommendations(subFloorInput);

      // If floor gating were removed, add_creative/pause would appear here —
      // that's the failure mode this test catches.
      const destructiveRec = recs(result).find(
        (r) => r.action === "add_creative" || r.action === "pause",
      );
      expect(destructiveRec).toBeUndefined();
    });
  });
});
