import { describe, it, expect } from "vitest";
import { RecommendationHandoffInput } from "../recommendation-handoff.js";

describe("RecommendationHandoffInput", () => {
  it("accepts a creative refresh handoff", () => {
    const parsed = RecommendationHandoffInput.parse({
      recommendationId: "rec_1",
      actionType: "refresh_creative",
      campaignId: "camp_1",
      rationale: "creative fatigue detected",
      evidence: { clicks: 120, conversions: 9, days: 14 },
    });
    expect(parsed.actionType).toBe("refresh_creative");
  });

  it("rejects an actionType outside the Riley action enum", () => {
    expect(() =>
      RecommendationHandoffInput.parse({
        recommendationId: "rec_1",
        actionType: "lead_quality", // a diagnosis pattern, NOT an action - must reject
        campaignId: "camp_1",
        rationale: "x",
        evidence: { clicks: 1, conversions: 0, days: 1 },
      }),
    ).toThrow();
  });

  it("rejects a missing recommendationId", () => {
    expect(() =>
      RecommendationHandoffInput.parse({
        actionType: "add_creative",
        campaignId: "camp_1",
        rationale: "x",
        evidence: { clicks: 1, conversions: 0, days: 1 },
      }),
    ).toThrow();
  });
});
