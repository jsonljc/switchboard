// packages/core/src/ad-optimizer/__tests__/learning-phase-guard.test.ts
import { describe, it, expect } from "vitest";
import {
  LearningPhaseGuard,
  type CampaignLearningInput,
  type PerformanceMetrics,
  type PerformanceTargets,
} from "../learning-phase-guard.js";
import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";

const CAMPAIGN_ID = "camp_001";

function makeInput(overrides: Partial<CampaignLearningInput> = {}): CampaignLearningInput {
  return {
    effectiveStatus: "ACTIVE",
    learningPhase: false,
    lastModifiedDays: 10,
    optimizationEvents: 60,
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<RecommendationOutput> = {}): RecommendationOutput {
  return {
    type: "recommendation",
    action: "scale",
    campaignId: CAMPAIGN_ID,
    campaignName: "Test Campaign",
    confidence: 0.85,
    urgency: "this_week",
    estimatedImpact: "+20% conversions",
    steps: ["Increase budget by 20%"],
    learningPhaseImpact: "none",
    ...overrides,
  };
}

describe("LearningPhaseGuard", () => {
  const guard = new LearningPhaseGuard();

  // ── check() tests ──

  describe("check()", () => {
    it("detects learning from API status when learningPhase=true", () => {
      const input = makeInput({
        learningPhase: true,
        lastModifiedDays: 10,
        optimizationEvents: 60,
      });
      const status = guard.check(CAMPAIGN_ID, input);

      expect(status.inLearning).toBe(true);
      expect(status.campaignId).toBe(CAMPAIGN_ID);
      expect(status.estimatedExitDate).not.toBeNull();
    });

    it("detects learning from data when lastModifiedDays<7 AND events<50 even when API says stable", () => {
      const input = makeInput({
        learningPhase: false,
        lastModifiedDays: 3,
        optimizationEvents: 20,
      });
      const status = guard.check(CAMPAIGN_ID, input);

      expect(status.inLearning).toBe(true);
      expect(status.daysSinceChange).toBe(3);
      expect(status.eventsAccumulated).toBe(20);
      expect(status.eventsRequired).toBe(50);
      expect(status.estimatedExitDate).not.toBeNull();
    });

    it("marks stable when past 7 days with sufficient events", () => {
      const input = makeInput({
        learningPhase: false,
        lastModifiedDays: 10,
        optimizationEvents: 60,
      });
      const status = guard.check(CAMPAIGN_ID, input);

      expect(status.inLearning).toBe(false);
      expect(status.estimatedExitDate).toBeNull();
    });
  });

  // ── gate() tests ──

  describe("gate()", () => {
    it("downgrades recommendation to watch when in learning", () => {
      const input = makeInput({ learningPhase: true, lastModifiedDays: 3, optimizationEvents: 20 });
      const status = guard.check(CAMPAIGN_ID, input);
      const recommendation = makeRecommendation();

      const result = guard.gate(recommendation, status);

      expect(result.type).toBe("watch");
      const watch = result as WatchOutput;
      expect(watch.pattern).toBe("in_learning_phase");
      expect(watch.checkBackDate).toBeDefined();
      expect(watch.message).toContain("in learning");
      expect(watch.message).toContain("scale");
    });

    it("passes through recommendation when not in learning", () => {
      const input = makeInput({
        learningPhase: false,
        lastModifiedDays: 10,
        optimizationEvents: 60,
      });
      const status = guard.check(CAMPAIGN_ID, input);
      const recommendation = makeRecommendation();

      const result = guard.gate(recommendation, status);

      expect(result.type).toBe("recommendation");
      expect(result).toBe(recommendation); // same reference — unchanged
    });
  });

  // ── isPerformingWell() tests ──

  describe("isPerformingWell()", () => {
    it("returns true when CPA is below target and ROAS is above target", () => {
      const metrics: PerformanceMetrics = { cpa: 20, roas: 3.5 };
      const targets: PerformanceTargets = { targetCPA: 25, targetROAS: 3.0 };

      expect(guard.isPerformingWell(metrics, targets)).toBe(true);
    });

    it("returns false when CPA is above target", () => {
      const metrics: PerformanceMetrics = { cpa: 30, roas: 3.5 };
      const targets: PerformanceTargets = { targetCPA: 25, targetROAS: 3.0 };

      expect(guard.isPerformingWell(metrics, targets)).toBe(false);
    });
  });
});
