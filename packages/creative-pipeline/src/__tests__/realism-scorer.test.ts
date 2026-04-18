import { describe, it, expect, vi } from "vitest";
import {
  evaluateRealism,
  computeDecision,
  computeWeightedSoftScore,
  DEFAULT_QA_THRESHOLDS,
  type QaThresholdConfig,
} from "../ugc/realism-scorer.js";
import type { RealismScore } from "@switchboard/schemas";

// Mock Claude for the LLM-based scorer
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    faceSimilarity: 0.85,
    ocrAccuracy: 0.9,
    artifactFlags: [],
    visualRealism: 0.8,
    behavioralRealism: 0.75,
    ugcAuthenticity: 0.9,
    audioNaturalness: 0.7,
  }),
}));

describe("computeWeightedSoftScore", () => {
  it("computes weighted average with default weights", () => {
    const score = computeWeightedSoftScore({
      visualRealism: 0.8,
      behavioralRealism: 0.75,
      ugcAuthenticity: 0.9,
      audioNaturalness: 0.7,
    });
    // 0.20*0.8 + 0.20*0.75 + 0.35*0.9 + 0.25*0.7 = 0.16 + 0.15 + 0.315 + 0.175 = 0.8
    expect(score).toBeCloseTo(0.8, 2);
  });

  it("handles missing scores gracefully (treat as 0)", () => {
    const score = computeWeightedSoftScore({});
    expect(score).toBe(0);
  });

  it("handles partial scores", () => {
    const score = computeWeightedSoftScore({ ugcAuthenticity: 1.0 });
    // Only ugcAuthenticity contributes: 0.35 * 1.0 = 0.35
    expect(score).toBeCloseTo(0.35, 2);
  });
});

describe("computeDecision", () => {
  const thresholds = DEFAULT_QA_THRESHOLDS;

  it("returns 'fail' when faceSimilarity below threshold", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.5, artifactFlags: [] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass", // will be overridden
    };
    expect(computeDecision(score, thresholds)).toBe("fail");
  });

  it("returns 'fail' when ocrAccuracy below threshold", () => {
    const score: RealismScore = {
      hardChecks: { ocrAccuracy: 0.5, artifactFlags: [] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("fail");
  });

  it("returns 'fail' when critical artifact flag present", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: ["face_drift"] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("fail");
  });

  it("returns 'review' when weighted soft score below threshold", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: [] },
      softScores: {
        visualRealism: 0.3,
        behavioralRealism: 0.3,
        ugcAuthenticity: 0.3,
        audioNaturalness: 0.3,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("review");
  });

  it("returns 'pass' when all checks pass", () => {
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: [] },
      softScores: {
        visualRealism: 0.8,
        behavioralRealism: 0.8,
        ugcAuthenticity: 0.8,
        audioNaturalness: 0.8,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("pass");
  });

  it("passes when hard check values are missing (not applicable)", () => {
    const score: RealismScore = {
      hardChecks: { artifactFlags: [] },
      softScores: {
        visualRealism: 0.8,
        behavioralRealism: 0.8,
        ugcAuthenticity: 0.8,
        audioNaturalness: 0.8,
      },
      overallDecision: "pass",
    };
    expect(computeDecision(score, thresholds)).toBe("pass");
  });

  it("supports custom thresholds", () => {
    const strict: QaThresholdConfig = {
      ...thresholds,
      hardCheckDefaults: { ...thresholds.hardCheckDefaults, faceSimilarityMin: 0.95 },
    };
    const score: RealismScore = {
      hardChecks: { faceSimilarity: 0.9, artifactFlags: [] },
      softScores: {
        visualRealism: 0.9,
        behavioralRealism: 0.9,
        ugcAuthenticity: 0.9,
        audioNaturalness: 0.9,
      },
      overallDecision: "pass",
    };
    // 0.9 < 0.95 threshold → fail
    expect(computeDecision(score, strict)).toBe("fail");
  });
});

describe("evaluateRealism", () => {
  it("calls Claude and returns a complete RealismScore", async () => {
    const result = await evaluateRealism({
      videoUrl: "https://cdn.example.com/video.mp4",
      creatorReferenceUrl: "https://cdn.example.com/ref.jpg",
      specDescription: "Talking head confession ad",
      apiKey: "test-key",
    });
    expect(result.hardChecks.faceSimilarity).toBeDefined();
    expect(result.hardChecks.artifactFlags).toBeDefined();
    expect(result.softScores.visualRealism).toBeDefined();
    expect(result.softScores.ugcAuthenticity).toBeDefined();
    expect(result.overallDecision).toBeDefined();
    expect(["pass", "review", "fail"]).toContain(result.overallDecision);
  });
});
