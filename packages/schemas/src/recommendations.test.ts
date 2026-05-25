import { describe, expect, it } from "vitest";
import { RecommendationInputSchema } from "./recommendations.js";

const VALID_BASE = {
  orgId: "org-1",
  agentKey: "riley",
  intent: "recommendation.ad_set_pause",
  action: "pause",
  humanSummary: "Pause Q2-Lookalikes — frequency hit 4.8.",
  confidence: 0.85,
  dollarsAtRisk: 400,
  riskLevel: "low" as const,
  parameters: {},
  presentation: {
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [],
  },
};

describe("RecommendationInputSchema — risk contract fields", () => {
  it("parses all four boolean fields when explicitly provided", () => {
    const parsed = RecommendationInputSchema.parse({
      ...VALID_BASE,
      riskLevel: "low",
      externalEffect: false,
      financialEffect: true,
      clientFacing: false,
      requiresConfirmation: true,
    });
    expect(parsed.financialEffect).toBe(true);
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.externalEffect).toBe(false);
    expect(parsed.clientFacing).toBe(false);
  });

  it("defaults all four boolean fields to false when not provided", () => {
    const parsed = RecommendationInputSchema.parse(VALID_BASE);
    expect(parsed.externalEffect).toBe(false);
    expect(parsed.financialEffect).toBe(false);
    expect(parsed.clientFacing).toBe(false);
    expect(parsed.requiresConfirmation).toBe(false);
  });

  it("preserves riskLevel alongside the new fields", () => {
    const parsed = RecommendationInputSchema.parse({
      ...VALID_BASE,
      riskLevel: "high",
      externalEffect: true,
    });
    expect(parsed.riskLevel).toBe("high");
    expect(parsed.externalEffect).toBe(true);
    expect(parsed.financialEffect).toBe(false);
  });
});
