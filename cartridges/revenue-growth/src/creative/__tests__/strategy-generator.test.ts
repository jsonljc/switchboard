import { describe, it, expect, vi } from "vitest";
import { generateCreativeStrategy } from "../strategy-generator.js";
import type {
  CreativeGapResult,
  CreativeGapCriterion,
  AccountLearningProfile,
} from "@switchboard/schemas";
import type { LLMClient } from "@switchboard/core";

function makeGapResult(overrides: Partial<CreativeGapResult> = {}): CreativeGapResult {
  const criteria: CreativeGapCriterion[] = [
    {
      name: "FORMAT_DIVERSITY",
      score: 30,
      weight: 0.15,
      weightedScore: 4.5,
      findings: ["Low diversity"],
    },
    {
      name: "HOOK_VARIETY",
      score: 40,
      weight: 0.15,
      weightedScore: 6,
      findings: ["Limited hooks"],
    },
    { name: "CTA_COVERAGE", score: 70, weight: 0.1, weightedScore: 7, findings: [] },
    { name: "AUDIENCE_MATCH", score: 45, weight: 0.15, weightedScore: 6.75, findings: ["Low CTR"] },
    { name: "PLATFORM_FIT", score: 65, weight: 0.1, weightedScore: 6.5, findings: [] },
    { name: "RECENCY", score: 25, weight: 0.2, weightedScore: 5, findings: ["High fatigue"] },
    { name: "PERFORMANCE_SPREAD", score: 55, weight: 0.15, weightedScore: 8.25, findings: [] },
  ];

  return {
    overallScore: 44,
    criteria,
    significantGaps: ["FORMAT_DIVERSITY", "HOOK_VARIETY", "AUDIENCE_MATCH", "RECENCY"],
    hasSignificantGaps: true,
    analyzedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<AccountLearningProfile> = {}): AccountLearningProfile {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    creativePatterns: [
      { format: "video", performanceScore: 85, sampleSize: 10 },
      { format: "image", performanceScore: 60, sampleSize: 15 },
    ],
    constraintHistory: [],
    calibration: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("generateCreativeStrategy", () => {
  it("generates strategy from template when no LLM", async () => {
    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult);

    expect(strategy.headline).toBeDefined();
    expect(strategy.prioritizedGaps.length).toBeGreaterThan(0);
    expect(strategy.recommendations.length).toBeGreaterThan(0);
    expect(strategy.testHypotheses.length).toBeGreaterThan(0);
    expect(strategy.generatedAt).toBeDefined();
  });

  it("prioritizes gaps by lowest score", async () => {
    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult);

    // RECENCY (25) should be prioritized over FORMAT_DIVERSITY (30)
    expect(strategy.prioritizedGaps[0]).toBe("RECENCY");
  });

  it("assigns correct priority levels to recommendations", async () => {
    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult);

    expect(strategy.recommendations[0]!.priority).toBe("high");
    expect(strategy.recommendations[1]!.priority).toBe("medium");
  });

  it("includes test hypotheses for identified gaps", async () => {
    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult);

    const hypothesisTexts = strategy.testHypotheses.join(" ");
    expect(hypothesisTexts).toContain("H1");
  });

  it("adds profile-informed hypothesis when profile available", async () => {
    const gapResult = makeGapResult();
    const profile = makeProfile();
    const strategy = await generateCreativeStrategy(gapResult, { accountProfile: profile });

    const profileHypothesis = strategy.testHypotheses.find((h) => h.includes("video"));
    expect(profileHypothesis).toBeDefined();
  });

  it("handles no significant gaps gracefully", async () => {
    const gapResult = makeGapResult({
      significantGaps: [],
      hasSignificantGaps: false,
    });
    const strategy = await generateCreativeStrategy(gapResult);

    expect(strategy.headline).toContain("healthy");
    expect(strategy.recommendations).toEqual([]);
    expect(strategy.testHypotheses.length).toBeGreaterThan(0);
  });

  it("uses LLM when available", async () => {
    const llmClient: LLMClient = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          headline: "LLM-generated strategy",
          prioritizedGaps: ["RECENCY"],
          recommendations: [
            {
              gap: "RECENCY",
              action: "Launch 5 new creatives",
              priority: "high",
              expectedImpact: "15% CPA reduction",
            },
          ],
          testHypotheses: ["H1: Fresh creative will reduce CPA by 15%"],
        }),
      ),
    };

    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult, { llmClient });

    expect(llmClient.complete).toHaveBeenCalled();
    expect(strategy.headline).toContain("LLM-generated");
  });

  it("falls back to template when LLM fails", async () => {
    const llmClient: LLMClient = {
      complete: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    };

    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult, { llmClient });

    expect(strategy.headline).toBeDefined();
    expect(strategy.recommendations.length).toBeGreaterThan(0);
  });

  it("falls back to template when LLM returns invalid JSON", async () => {
    const llmClient: LLMClient = {
      complete: vi.fn().mockResolvedValue("This is not valid JSON"),
    };

    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult, { llmClient });

    // Should fall back to template strategy
    expect(strategy.recommendations.length).toBeGreaterThan(0);
  });

  it("includes expected impact for each recommendation", async () => {
    const gapResult = makeGapResult();
    const strategy = await generateCreativeStrategy(gapResult);

    for (const rec of strategy.recommendations) {
      expect(rec.expectedImpact).toBeDefined();
      expect(rec.expectedImpact.length).toBeGreaterThan(0);
    }
  });
});
