// packages/core/src/ad-optimizer/__tests__/recommendation-engine.test.ts
import { describe, it, expect } from "vitest";
import { generateRecommendations } from "../recommendation-engine.js";
import type { RecommendationInput } from "../recommendation-engine.js";
import type { Diagnosis } from "../metric-diagnostician.js";
import type { MetricDeltaSchema as MetricDelta } from "@switchboard/schemas";

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
  it("generates kill recommendation when CPA > 2x targetCPA and daysAboveTarget >= 7", () => {
    const input: RecommendationInput = {
      campaignId: "camp-1",
      campaignName: "Test Campaign",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      daysAboveTarget: 10,
    };

    const result = generateRecommendations(input);

    const kill = result.find((r) => r.action === "kill");
    expect(kill).toBeDefined();
    expect(kill?.urgency).toBe("immediate");
    expect(kill?.confidence).toBe(0.85);
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
      daysAboveTarget: 0,
    };

    const result = generateRecommendations(input);

    const scale = result.find((r) => r.action === "scale");
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
      daysAboveTarget: 0,
    };

    const result = generateRecommendations(input);

    const refresh = result.find((r) => r.action === "refresh_creative");
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
      daysAboveTarget: 0,
    };

    const result = generateRecommendations(input);

    const scale = result.find((r) => r.action === "scale");
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
      daysAboveTarget: 0,
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
      daysAboveTarget: 0,
    };

    const result = generateRecommendations(input);

    const refresh = result.find((r) => r.action === "refresh_creative");
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
      daysAboveTarget: 0,
    };

    const result = generateRecommendations(input);

    const restructure = result.find((r) => r.action === "restructure");
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
      daysAboveTarget: 2,
    };

    const result = generateRecommendations(input);

    const hold = result.find((r) => r.action === "hold");
    expect(hold).toBeDefined();
    expect(hold?.confidence).toBe(0.75);
    expect(hold?.urgency).toBe("this_week");
  });

  it("does not generate kill when daysAboveTarget < 7", () => {
    const input: RecommendationInput = {
      campaignId: "camp-9",
      campaignName: "Not Dead Yet",
      diagnoses: [],
      deltas: [makeDelta("cpa", 250, 100, "up", true)],
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 5000,
      daysAboveTarget: 5,
    };

    const result = generateRecommendations(input);

    const kill = result.find((r) => r.action === "kill");
    expect(kill).toBeUndefined();
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
      daysAboveTarget: 0,
    };

    const result = generateRecommendations(input);

    const scale = result.find((r) => r.action === "scale");
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
      daysAboveTarget: 10,
    };

    const result = generateRecommendations(input);

    expect(result.length).toBeGreaterThan(0);
    for (const rec of result) {
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
});
