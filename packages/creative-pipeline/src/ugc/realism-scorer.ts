// packages/creative-pipeline/src/ugc/realism-scorer.ts
// Realism QA for generated UGC video.
//
// Frame-based realism QA is NOT yet implemented: the model cannot see the
// generated video, so `evaluateRealism` does not fabricate scores from a URL.
// It returns `qaStatus: "requires_human_review"`, so an un-evaluated asset can
// never be auto-approved for spend. The pure helpers below (computeDecision /
// computeWeightedSoftScore / deriveApprovalState) are the decision logic for
// when a real frame-sampling evaluator lands and sets `qaStatus: "evaluated"`.

import type { RealismScore, RealismSoftScores } from "@switchboard/schemas";

// ── Threshold Config ──

export interface QaThresholdConfig {
  version: string;
  hardCheckDefaults: {
    faceSimilarityMin: number;
    ocrAccuracyMin: number;
    voiceSimilarityMin: number;
    criticalArtifacts: string[];
  };
  softScoreDefaults: {
    reviewThreshold: number;
    weights: {
      visualRealism: number;
      behavioralRealism: number;
      ugcAuthenticity: number;
      audioNaturalness: number;
    };
  };
}

export const DEFAULT_QA_THRESHOLDS: QaThresholdConfig = {
  version: "v1",
  hardCheckDefaults: {
    faceSimilarityMin: 0.7,
    ocrAccuracyMin: 0.8,
    voiceSimilarityMin: 0.75,
    criticalArtifacts: ["face_drift", "product_warp", "hand_warp"],
  },
  softScoreDefaults: {
    reviewThreshold: 0.5,
    weights: {
      visualRealism: 0.2,
      behavioralRealism: 0.2,
      ugcAuthenticity: 0.35,
      audioNaturalness: 0.25,
    },
  },
};

// ── Input ──

// `creatorReferenceUrl`, `apiKey`, and `thresholds` are reserved for the future
// frame-based evaluator (see `evaluateRealism`); the current honest stub ignores them.
export interface RealismScorerInput {
  videoUrl: string;
  creatorReferenceUrl?: string;
  specDescription: string;
  apiKey: string;
  thresholds?: QaThresholdConfig;
}

// ── Weighted soft score ──

export function computeWeightedSoftScore(
  softScores: Partial<RealismSoftScores>,
  weights = DEFAULT_QA_THRESHOLDS.softScoreDefaults.weights,
): number {
  return (
    weights.visualRealism * (softScores.visualRealism ?? 0) +
    weights.behavioralRealism * (softScores.behavioralRealism ?? 0) +
    weights.ugcAuthenticity * (softScores.ugcAuthenticity ?? 0) +
    weights.audioNaturalness * (softScores.audioNaturalness ?? 0)
  );
}

// ── Decision logic (applies once a real evaluator has produced scores) ──

export function computeDecision(
  score: RealismScore,
  thresholds: QaThresholdConfig = DEFAULT_QA_THRESHOLDS,
): "pass" | "review" | "fail" {
  const { hardCheckDefaults, softScoreDefaults } = thresholds;

  // Hard check gates (fail immediately)
  if (
    score.hardChecks.faceSimilarity !== undefined &&
    score.hardChecks.faceSimilarity < hardCheckDefaults.faceSimilarityMin
  ) {
    return "fail";
  }

  if (
    score.hardChecks.ocrAccuracy !== undefined &&
    score.hardChecks.ocrAccuracy < hardCheckDefaults.ocrAccuracyMin
  ) {
    return "fail";
  }

  // Critical artifact flags
  const hasCriticalArtifact = score.hardChecks.artifactFlags.some((flag) =>
    hardCheckDefaults.criticalArtifacts.includes(flag),
  );
  if (hasCriticalArtifact) {
    return "fail";
  }

  // Weighted soft score threshold
  const weightedScore = computeWeightedSoftScore(score.softScores, softScoreDefaults.weights);
  if (weightedScore < softScoreDefaults.reviewThreshold) {
    return "review";
  }

  return "pass";
}

// ── QA result → persisted approval state ──

/**
 * Map a QA result to the asset's persisted approval state.
 *
 * SAFETY INVARIANT: a creative may be auto-`approved` ONLY when the video was
 * actually evaluated (`qaStatus === "evaluated"`) AND passed. Until real
 * frame-based QA exists, scorers return `qaStatus: "requires_human_review"`, so
 * this function routes everything to human review — an un-evaluated or fabricated
 * score can never approve a creative for spend.
 */
export function deriveApprovalState(
  score: RealismScore,
): "approved" | "rejected" | "requires_human_review" {
  if (score.qaStatus !== "evaluated") return "requires_human_review";
  if (score.overallDecision === "pass") return "approved";
  if (score.overallDecision === "fail") return "rejected";
  return "requires_human_review";
}

// ── Main scorer ──

/**
 * Realism QA entry point.
 *
 * Frame-based evaluation is not yet implemented, so this NEVER inspects the
 * actual video and NEVER fabricates a score from a URL. It returns
 * `qaStatus: "requires_human_review"` so the asset is routed to a human and can
 * never be auto-approved for spend. When a real frame-sampling evaluator is
 * added it should set `qaStatus: "evaluated"`, populate the hard/soft checks,
 * and call `computeDecision`; `deriveApprovalState` then gates approval on the
 * real result. `_input` is accepted now for forward-compatibility.
 */
export async function evaluateRealism(_input: RealismScorerInput): Promise<RealismScore> {
  return {
    hardChecks: { artifactFlags: [] },
    softScores: {},
    overallDecision: "review",
    qaStatus: "requires_human_review",
  };
}
