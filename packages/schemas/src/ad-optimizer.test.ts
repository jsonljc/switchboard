import { describe, it, expect } from "vitest";
import {
  RecommendationOutputSchema,
  EconomicTierSchema,
  MarginBasisSchema,
} from "./ad-optimizer.js";

const base = {
  type: "recommendation" as const,
  action: "pause" as const,
  campaignId: "c1",
  campaignName: "C1",
  confidence: 0.9,
  urgency: "immediate" as const,
  estimatedImpact: "x",
  steps: ["a"],
  learningPhaseImpact: "no impact",
  resetsLearning: "no" as const,
};

describe("RecommendationOutputSchema economic fields", () => {
  it("parses without the new fields (back-compat)", () => {
    expect(RecommendationOutputSchema.parse(base).economicTier).toBeUndefined();
  });
  it("parses with economicTier + marginBasis", () => {
    const r = RecommendationOutputSchema.parse({
      ...base,
      economicTier: "booked_cac",
      marginBasis: "unavailable",
    });
    expect(r.economicTier).toBe("booked_cac");
    expect(r.marginBasis).toBe("unavailable");
  });
  it("rejects an unknown economic tier", () => {
    expect(() => RecommendationOutputSchema.parse({ ...base, economicTier: "roas" })).toThrow();
  });
  it("exposes the enums", () => {
    expect(EconomicTierSchema.options).toEqual(["booked_cac", "cpl", "cpc"]);
    expect(MarginBasisSchema.options).toEqual(["configured", "unavailable"]);
  });

  it("RecommendationOutput requires a resetsLearning class", () => {
    const withoutResets = {
      type: "recommendation" as const,
      action: "scale" as const,
      campaignId: "c",
      campaignName: "C",
      confidence: 0.7,
      urgency: "this_week" as const,
      estimatedImpact: "x",
      steps: ["x"],
      learningPhaseImpact: "no impact",
    };
    expect(RecommendationOutputSchema.safeParse(withoutResets).success).toBe(false);
    expect(
      RecommendationOutputSchema.safeParse({ ...withoutResets, resetsLearning: "no" }).success,
    ).toBe(true);
  });
});
