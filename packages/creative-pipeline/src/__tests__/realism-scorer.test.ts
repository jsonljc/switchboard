import { describe, it, expect, vi } from "vitest";
import {
  evaluateRealism,
  computeDecision,
  computeWeightedSoftScore,
  deriveApprovalState,
  DEFAULT_QA_THRESHOLDS,
  type QaThresholdConfig,
} from "../ugc/realism-scorer.js";
import { AssetApprovalState, type RealismScore } from "@switchboard/schemas";

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

  it("all-absent returns 0 (review)", () => {
    const score = computeWeightedSoftScore({});
    expect(score).toBe(0);
  });

  it("renormalizes partial scores over present dimensions (slice-3 contract change)", () => {
    // A frame evaluator cannot honestly score every dimension (audio has no
    // frames); absent dimensions renormalize instead of dragging toward 0.
    const score = computeWeightedSoftScore({ ugcAuthenticity: 1.0 });
    expect(score).toBeCloseTo(1.0, 2);
  });

  it("renormalizes a two-dimension score over the present weight mass", () => {
    // (0.2*0.6 + 0.2*0.8) / (0.2 + 0.2) = 0.7
    const score = computeWeightedSoftScore({ visualRealism: 0.6, behavioralRealism: 0.8 });
    expect(score).toBeCloseTo(0.7, 2);
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
      qaStatus: "evaluated",
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
      qaStatus: "evaluated",
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
      qaStatus: "evaluated",
    };
    expect(computeDecision(score, thresholds)).toBe("fail");
  });

  it.each(["garbled_text", "broken_frame", "anatomical_error", "missing_subject"])(
    "returns 'fail' for the slice-3 critical artifact %s",
    (flag) => {
      const score: RealismScore = {
        hardChecks: { artifactFlags: [flag] },
        softScores: {
          visualRealism: 0.9,
          behavioralRealism: 0.9,
          ugcAuthenticity: 0.9,
          audioNaturalness: 0.9,
        },
        overallDecision: "pass",
        qaStatus: "evaluated",
      };
      expect(computeDecision(score, thresholds)).toBe("fail");
    },
  );

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
      qaStatus: "evaluated",
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
      qaStatus: "evaluated",
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
      qaStatus: "evaluated",
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
      qaStatus: "evaluated",
    };
    // 0.9 < 0.95 threshold → fail
    expect(computeDecision(score, strict)).toBe("fail");
  });
});

describe("evaluateRealism", () => {
  it("does NOT call the LLM to 'score' a video it cannot see", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockClear();
    await evaluateRealism({
      videoUrl: "https://cdn.example.com/video.mp4",
      creatorReferenceUrl: "https://cdn.example.com/ref.jpg",
      specDescription: "Talking head confession ad",
      apiKey: "test-key",
    });
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("reports requires_human_review and never auto-passes (no real evaluation yet)", async () => {
    const result = await evaluateRealism({
      videoUrl: "https://cdn.example.com/video.mp4",
      specDescription: "Talking head confession ad",
      apiKey: "test-key",
    });
    expect(result.qaStatus).toBe("requires_human_review");
    expect(result.overallDecision).not.toBe("pass");
  });
});

describe("deriveApprovalState", () => {
  const base = { hardChecks: { artifactFlags: [] }, softScores: {} };

  it("approves ONLY when the video was actually evaluated and passed", () => {
    expect(deriveApprovalState({ ...base, overallDecision: "pass", qaStatus: "evaluated" })).toBe(
      "approved",
    );
  });

  it("rejects when actually evaluated and failed", () => {
    expect(deriveApprovalState({ ...base, overallDecision: "fail", qaStatus: "evaluated" })).toBe(
      "rejected",
    );
  });

  it("requires human review when evaluated but indecisive", () => {
    expect(deriveApprovalState({ ...base, overallDecision: "review", qaStatus: "evaluated" })).toBe(
      "requires_human_review",
    );
  });

  it("NEVER auto-approves an unseen video, even if the decision field says 'pass'", () => {
    expect(
      deriveApprovalState({ ...base, overallDecision: "pass", qaStatus: "requires_human_review" }),
    ).toBe("requires_human_review");
    expect(
      deriveApprovalState({ ...base, overallDecision: "pass", qaStatus: "not_evaluated" }),
    ).toBe("requires_human_review");
  });

  it("only ever returns values that are valid AssetApprovalState members (schemas stay in sync)", () => {
    const cases: RealismScore[] = [
      { ...base, overallDecision: "pass", qaStatus: "evaluated" },
      { ...base, overallDecision: "fail", qaStatus: "evaluated" },
      { ...base, overallDecision: "review", qaStatus: "evaluated" },
      { ...base, overallDecision: "pass", qaStatus: "requires_human_review" },
      { ...base, overallDecision: "pass", qaStatus: "not_evaluated" },
    ];
    for (const score of cases) {
      expect(AssetApprovalState.safeParse(deriveApprovalState(score)).success).toBe(true);
    }
  });
});
