import { describe, it, expect, beforeEach } from "vitest";
import {
  ProgressiveAutonomyController,
  DEFAULT_AUTONOMY_THRESHOLDS,
} from "../progressive-autonomy.js";
import type { CompetenceSnapshot } from "../progressive-autonomy.js";

describe("ProgressiveAutonomyController", () => {
  let controller: ProgressiveAutonomyController;

  beforeEach(() => {
    controller = new ProgressiveAutonomyController();
  });

  describe("guarded → observe", () => {
    it("recommends observe after enough successes and score", () => {
      const competence: CompetenceSnapshot = {
        score: 65,
        successCount: 12,
        failureCount: 1,
        rollbackCount: 0,
      };

      const result = controller.assess("guarded", competence);
      expect(result.recommendedProfile).toBe("observe");
      expect(result.progressPercent).toBe(100);
      expect(result.reason).toContain("Ready for observe mode");
    });

    it("stays guarded with insufficient successes", () => {
      const competence: CompetenceSnapshot = {
        score: 65,
        successCount: 5,
        failureCount: 0,
        rollbackCount: 0,
      };

      const result = controller.assess("guarded", competence);
      expect(result.recommendedProfile).toBe("guarded");
      expect(result.reason).toContain("5/10");
    });

    it("stays guarded with low score", () => {
      const competence: CompetenceSnapshot = {
        score: 30,
        successCount: 15,
        failureCount: 0,
        rollbackCount: 0,
      };

      const result = controller.assess("guarded", competence);
      expect(result.recommendedProfile).toBe("guarded");
    });

    it("stays guarded with too many failures", () => {
      const competence: CompetenceSnapshot = {
        score: 70,
        successCount: 15,
        failureCount: 5,
        rollbackCount: 2,
      };

      const result = controller.assess("guarded", competence);
      expect(result.recommendedProfile).toBe("guarded");
      expect(result.reason).toContain("Failure rate");
    });
  });

  describe("observe → autonomous", () => {
    it("makes autonomous eligible after 30 successes with high score", () => {
      const competence: CompetenceSnapshot = {
        score: 85,
        successCount: 35,
        failureCount: 2,
        rollbackCount: 0,
      };

      const result = controller.assess("observe", competence);
      expect(result.autonomousEligible).toBe(true);
      expect(result.reason).toContain("Autonomous mode available");
    });

    it("stays observe without opt-in even when eligible", () => {
      const competence: CompetenceSnapshot = {
        score: 85,
        successCount: 35,
        failureCount: 2,
        rollbackCount: 0,
      };

      const result = controller.assess("observe", competence, false);
      expect(result.recommendedProfile).toBe("observe");
      expect(result.autonomousEligible).toBe(true);
    });

    it("confirms autonomous mode with owner opt-in", () => {
      const competence: CompetenceSnapshot = {
        score: 85,
        successCount: 35,
        failureCount: 2,
        rollbackCount: 0,
      };

      const result = controller.assess("observe", competence, true);
      expect(result.autonomousEligible).toBe(true);
      expect(result.reason).toContain("Autonomous mode active");
    });

    it("shows progress toward autonomous eligibility", () => {
      const competence: CompetenceSnapshot = {
        score: 70,
        successCount: 20,
        failureCount: 1,
        rollbackCount: 0,
      };

      const result = controller.assess("observe", competence);
      expect(result.autonomousEligible).toBe(false);
      expect(result.reason).toContain("20/30");
      expect(result.progressPercent).toBeGreaterThan(0);
      expect(result.progressPercent).toBeLessThan(100);
    });

    it("demotes to guarded when score drops significantly", () => {
      const competence: CompetenceSnapshot = {
        score: 30,
        successCount: 12,
        failureCount: 8,
        rollbackCount: 3,
      };

      const result = controller.assess("observe", competence);
      expect(result.recommendedProfile).toBe("guarded");
      expect(result.reason).toContain("Reverting to guarded");
    });
  });

  describe("locked profile", () => {
    it("stays locked regardless of competence", () => {
      const competence: CompetenceSnapshot = {
        score: 100,
        successCount: 100,
        failureCount: 0,
        rollbackCount: 0,
      };

      const result = controller.assess("locked", competence);
      expect(result.recommendedProfile).toBe("locked");
      expect(result.autonomousEligible).toBe(false);
      expect(result.reason).toContain("Manual override required");
    });
  });

  describe("strict profile", () => {
    it("promotes to guarded when score recovers", () => {
      const competence: CompetenceSnapshot = {
        score: 65,
        successCount: 8,
        failureCount: 1,
        rollbackCount: 0,
      };

      const result = controller.assess("strict", competence);
      expect(result.recommendedProfile).toBe("guarded");
    });

    it("stays strict with low score", () => {
      const competence: CompetenceSnapshot = {
        score: 30,
        successCount: 3,
        failureCount: 5,
        rollbackCount: 2,
      };

      const result = controller.assess("strict", competence);
      expect(result.recommendedProfile).toBe("strict");
    });
  });

  describe("custom thresholds", () => {
    it("respects custom thresholds", () => {
      const strict = new ProgressiveAutonomyController({
        observeMinSuccesses: 20,
        observeMinScore: 80,
      });

      const competence: CompetenceSnapshot = {
        score: 65,
        successCount: 12,
        failureCount: 1,
        rollbackCount: 0,
      };

      // Would pass default thresholds but fails custom ones
      const result = strict.assess("guarded", competence);
      expect(result.recommendedProfile).toBe("guarded");
    });
  });

  describe("stats reporting", () => {
    it("includes accurate stats in assessment", () => {
      const competence: CompetenceSnapshot = {
        score: 50,
        successCount: 8,
        failureCount: 2,
        rollbackCount: 1,
      };

      const result = controller.assess("guarded", competence);
      expect(result.stats.totalSuccesses).toBe(8);
      expect(result.stats.totalFailures).toBe(3); // failures + rollbacks
      expect(result.stats.competenceScore).toBe(50);
      expect(result.stats.failureRate).toBeCloseTo(0.27, 1);
    });
  });

  describe("formatAssessment", () => {
    it("formats upgrade message", () => {
      const assessment = controller.assess("guarded", {
        score: 65,
        successCount: 12,
        failureCount: 1,
        rollbackCount: 0,
      });

      const message = controller.formatAssessment(assessment);
      expect(message).toContain("guarded");
      expect(message).toContain("observe");
    });

    it("formats autonomous eligible message", () => {
      const assessment = controller.assess("observe", {
        score: 85,
        successCount: 35,
        failureCount: 2,
        rollbackCount: 0,
      });

      const message = controller.formatAssessment(assessment);
      expect(message).toContain("Autonomous mode");
    });
  });
});

describe("DEFAULT_AUTONOMY_THRESHOLDS", () => {
  it("has expected default values", () => {
    expect(DEFAULT_AUTONOMY_THRESHOLDS.observeMinSuccesses).toBe(10);
    expect(DEFAULT_AUTONOMY_THRESHOLDS.autonomousMinSuccesses).toBe(30);
    expect(DEFAULT_AUTONOMY_THRESHOLDS.observeMinScore).toBe(60);
    expect(DEFAULT_AUTONOMY_THRESHOLDS.autonomousMinScore).toBe(80);
    expect(DEFAULT_AUTONOMY_THRESHOLDS.maxFailureRate).toBe(0.15);
  });
});
