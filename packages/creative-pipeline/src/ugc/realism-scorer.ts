// packages/core/src/creative-pipeline/ugc/realism-scorer.ts
// SP6: Full hybrid realism scorer — replaces SP5's minimal-qa.ts.
// Uses Claude Vision for both hard checks and soft scores.
// SP9 upgrades hard checks to specialized models (ArcFace, SyncNet, etc.).

import { callClaude } from "../stages/call-claude.js";
import { z } from "zod";
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

export interface RealismScorerInput {
  videoUrl: string;
  creatorReferenceUrl?: string;
  specDescription: string;
  apiKey: string;
  thresholds?: QaThresholdConfig;
}

// ── Claude output schema ──

const ClaudeRealismOutputSchema = z.object({
  faceSimilarity: z.number().min(0).max(1).optional(),
  ocrAccuracy: z.number().min(0).max(1).optional(),
  artifactFlags: z.array(z.string()),
  visualRealism: z.number().min(0).max(1),
  behavioralRealism: z.number().min(0).max(1),
  ugcAuthenticity: z.number().min(0).max(1),
  audioNaturalness: z.number().min(0).max(1),
});

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

// ── Decision logic ──

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

// ── Prompt ──

function buildRealismPrompt(input: RealismScorerInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `You are a UGC ad quality scorer. Evaluate the generated video across multiple dimensions.

Score each dimension from 0.0 to 1.0:

## Hard Checks
- **faceSimilarity**: How closely does the face match the creator reference? (0 = completely different, 1 = identical). If no reference provided or no face visible, omit this field.
- **ocrAccuracy**: If product text/logos are shown, how legible and accurate are they? (0 = illegible, 1 = perfect). If no text/logos shown, omit this field.
- **artifactFlags**: List any visual artifacts detected. Valid flags: "face_drift", "hand_warp", "product_warp", "text_illegible", "uncanny_valley", "sync_mismatch", "lighting_inconsistency". Empty array if none.

## Soft Scores (always score all 4)
- **visualRealism**: Skin texture, lighting consistency, camera feel (0 = obviously CG, 1 = photorealistic)
- **behavioralRealism**: Natural blink, mouth movement, head motion, gestures (0 = robotic, 1 = human)
- **ugcAuthenticity**: Does this feel like a real person filmed this on their phone? (0 = studio production, 1 = authentic UGC)
- **audioNaturalness**: Natural speech patterns, breath sounds, room tone, pauses (0 = synthetic, 1 = natural). Score 0.5 if no audio.

Return a JSON object:
{
  "faceSimilarity": 0.85,
  "ocrAccuracy": 0.9,
  "artifactFlags": [],
  "visualRealism": 0.8,
  "behavioralRealism": 0.75,
  "ugcAuthenticity": 0.9,
  "audioNaturalness": 0.7
}

Respond ONLY with the JSON object.`;

  let userMessage = `Score this UGC video for realism:

**Video URL:** ${input.videoUrl}
**Creative brief:** ${input.specDescription}`;

  if (input.creatorReferenceUrl) {
    userMessage += `\n**Creator reference image:** ${input.creatorReferenceUrl}`;
  }

  return { systemPrompt, userMessage };
}

// ── Main scorer ──

/**
 * Full hybrid realism scorer (SP6).
 * Calls Claude Vision for both hard checks and soft scores in a single pass.
 * Applies configurable thresholds to produce pass/review/fail decision.
 */
export async function evaluateRealism(input: RealismScorerInput): Promise<RealismScore> {
  const thresholds = input.thresholds ?? DEFAULT_QA_THRESHOLDS;
  const { systemPrompt, userMessage } = buildRealismPrompt(input);

  const result = await callClaude({
    apiKey: input.apiKey,
    systemPrompt,
    userMessage,
    schema: ClaudeRealismOutputSchema,
    maxTokens: 1024,
  });

  const score: RealismScore = {
    hardChecks: {
      faceSimilarity: result.faceSimilarity,
      ocrAccuracy: result.ocrAccuracy,
      artifactFlags: result.artifactFlags,
    },
    softScores: {
      visualRealism: result.visualRealism,
      behavioralRealism: result.behavioralRealism,
      ugcAuthenticity: result.ugcAuthenticity,
      audioNaturalness: result.audioNaturalness,
    },
    overallDecision: "pass", // placeholder, computed below
  };

  score.overallDecision = computeDecision(score, thresholds);

  return score;
}
