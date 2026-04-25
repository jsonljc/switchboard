// packages/core/src/ad-optimizer/__tests__/learning-phase-guard.test.ts
import { describe, it, expect } from "vitest";
import {
  LearningPhaseGuard,
  LearningPhaseGuardV2,
  type CampaignLearningInput,
  type PerformanceMetrics,
  type PerformanceTargets,
} from "../learning-phase-guard.js";
import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
  AdSetLearningInput,
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

// ── V2 Tests ──

const AD_SET_ID = "adset_001";
const AD_SET_NAME = "Test Ad Set";

function makeAdSetInput(overrides: Partial<AdSetLearningInput> = {}): AdSetLearningInput {
  return {
    adSetId: AD_SET_ID,
    adSetName: AD_SET_NAME,
    campaignId: CAMPAIGN_ID,
    learningStageStatus: "LEARNING",
    frequency: 1.5,
    spend: 500,
    conversions: 20,
    cpa: 25,
    roas: 3.0,
    ctr: 2.5,
    ...overrides,
  };
}

function makeV2Recommendation(overrides: Partial<RecommendationOutput> = {}): RecommendationOutput {
  return {
    type: "recommendation",
    action: "pause",
    campaignId: CAMPAIGN_ID,
    campaignName: "Test Campaign",
    confidence: 0.85,
    urgency: "this_week",
    estimatedImpact: "+20% conversions",
    steps: ["Pause the ad set"],
    learningPhaseImpact: "high",
    ...overrides,
  };
}

describe("LearningPhaseGuardV2", () => {
  const guardV2 = new LearningPhaseGuardV2();

  // ── classifyState() tests ──

  describe("classifyState()", () => {
    it("maps LEARNING to learning state with metrics snapshot", () => {
      const input = makeAdSetInput({ learningStageStatus: "LEARNING" });
      const status = guardV2.classifyState(input);

      expect(status.adSetId).toBe(AD_SET_ID);
      expect(status.adSetName).toBe(AD_SET_NAME);
      expect(status.campaignId).toBe(CAMPAIGN_ID);
      expect(status.state).toBe("learning");
      expect(status.metricsSnapshot).toEqual({
        cpa: 25,
        roas: 3.0,
        ctr: 2.5,
        spend: 500,
        conversions: 20,
      });
      expect(status.exitStability).toBeNull();
    });

    it("maps FAIL to learning_limited state with metrics snapshot", () => {
      const input = makeAdSetInput({ learningStageStatus: "FAIL" });
      const status = guardV2.classifyState(input);

      expect(status.state).toBe("learning_limited");
      expect(status.metricsSnapshot).not.toBeNull();
    });

    it("maps SUCCESS to success state with pending exit stability", () => {
      const input = makeAdSetInput({ learningStageStatus: "SUCCESS" });
      const status = guardV2.classifyState(input);

      expect(status.state).toBe("success");
      expect(status.metricsSnapshot).toBeNull();
      expect(status.exitStability).toBe("pending");
    });

    it("maps unknown API states to unknown", () => {
      const input = makeAdSetInput({ learningStageStatus: "UNKNOWN" });
      const status = guardV2.classifyState(input);

      expect(status.state).toBe("unknown");
      expect(status.metricsSnapshot).toBeNull();
      expect(status.exitStability).toBeNull();
    });
  });

  // ── isDestructiveAction() tests ──

  describe("isDestructiveAction()", () => {
    it("considers pause destructive", () => {
      expect(guardV2.isDestructiveAction("pause")).toBe(true);
    });

    it("considers restructure destructive", () => {
      expect(guardV2.isDestructiveAction("restructure")).toBe(true);
    });

    it("considers refresh_creative non-destructive", () => {
      expect(guardV2.isDestructiveAction("refresh_creative")).toBe(false);
    });

    it("considers scale non-destructive", () => {
      expect(guardV2.isDestructiveAction("scale")).toBe(false);
    });
  });

  // ── gate() tests ──

  describe("gate()", () => {
    it("gates destructive actions during learning state", () => {
      const status = guardV2.classifyState(makeAdSetInput({ learningStageStatus: "LEARNING" }));
      const rec = makeV2Recommendation({ action: "pause" });

      const result = guardV2.gate(rec, status);

      expect(result.type).toBe("watch");
      const watch = result as WatchOutput;
      expect(watch.pattern).toBe("in_learning_phase");
      expect(watch.message).toContain("learning");
    });

    it("allows non-destructive actions during learning state", () => {
      const status = guardV2.classifyState(makeAdSetInput({ learningStageStatus: "LEARNING" }));
      const rec = makeV2Recommendation({ action: "refresh_creative" });

      const result = guardV2.gate(rec, status);

      expect(result.type).toBe("recommendation");
      expect(result).toBe(rec);
    });

    it("passes through for learning_limited state (even destructive)", () => {
      const status = guardV2.classifyState(makeAdSetInput({ learningStageStatus: "FAIL" }));
      const rec = makeV2Recommendation({ action: "pause" });

      const result = guardV2.gate(rec, status);

      expect(result.type).toBe("recommendation");
      expect(result).toBe(rec);
    });

    it("passes through for success state", () => {
      const status = guardV2.classifyState(makeAdSetInput({ learningStageStatus: "SUCCESS" }));
      const rec = makeV2Recommendation({ action: "restructure" });

      const result = guardV2.gate(rec, status);

      expect(result.type).toBe("recommendation");
      expect(result).toBe(rec);
    });
  });

  // ── diagnoseLearningLimited() tests ──

  describe("diagnoseLearningLimited()", () => {
    it("diagnoses audience_too_narrow when frequency > 3.0", () => {
      const input = makeAdSetInput({ learningStageStatus: "FAIL", frequency: 4.5, spend: 500 });
      const status = guardV2.classifyState(input);
      const diagnosis = guardV2.diagnoseLearningLimited(status, input);

      expect(diagnosis.cause).toBe("audience_too_narrow");
      expect(diagnosis.recommendation).toBe("expand_targeting");
    });

    it("diagnoses underfunded when spend < 100", () => {
      const input = makeAdSetInput({ learningStageStatus: "FAIL", frequency: 1.0, spend: 50 });
      const status = guardV2.classifyState(input);
      const diagnosis = guardV2.diagnoseLearningLimited(status, input);

      expect(diagnosis.cause).toBe("underfunded");
      expect(diagnosis.recommendation).toBe("consolidate");
    });

    it("diagnoses cost_constrained as fallback", () => {
      const input = makeAdSetInput({ learningStageStatus: "FAIL", frequency: 2.0, spend: 500 });
      const status = guardV2.classifyState(input);
      const diagnosis = guardV2.diagnoseLearningLimited(status, input);

      expect(diagnosis.cause).toBe("cost_constrained");
      expect(diagnosis.recommendation).toBe("review_budget");
    });
  });
});
