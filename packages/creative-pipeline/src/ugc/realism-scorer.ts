// packages/creative-pipeline/src/ugc/realism-scorer.ts
// Realism QA for generated UGC video.
//
// Frame-based realism QA is REAL when deps are injected (slice-3 spec 3.1):
// frames are extracted via ffmpeg and sent to the vision model as image
// content blocks; the score carries `qaStatus: "evaluated"` and a
// `computeDecision` verdict. Without deps, or on ANY infrastructure
// shortfall, `evaluateRealism` returns the honest stub
// (`qaStatus: "requires_human_review"`) so an un-evaluated asset can never
// be auto-approved for spend. The QA prompt gates OBJECTIVE INTEGRITY only;
// aesthetic judgment stays human.

import { rmSync } from "fs";
import { z } from "zod";
import type { RealismScore, RealismSoftScores } from "@switchboard/schemas";
import type { FrameExtractor } from "./frame-extractor.js";

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
    // Slice-3 (spec 3.1): the frame evaluator's bounded vocabulary joins the
    // critical set (config extension; decision LOGIC unchanged). A broken
    // frame or garbled anatomy is exactly the objective integrity breach the
    // fail gate exists for. `missing_subject` is the presence-check vehicle
    // (human absent in a talking_head clip).
    criticalArtifacts: [
      "face_drift",
      "product_warp",
      "hand_warp",
      "garbled_text",
      "broken_frame",
      "anatomical_error",
      "missing_subject",
    ],
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

// `creatorReferenceUrl` is reserved for a future faceSimilarity reference
// resolver (spec 3.1 leaves it unused in v1).
export interface RealismScorerInput {
  videoUrl: string;
  creatorReferenceUrl?: string;
  specDescription: string;
  apiKey: string;
  thresholds?: QaThresholdConfig;
  /** Spec format (e.g. "talking_head"); drives the presence check. */
  format?: string;
  /** Clip length for frame spacing; defaults inside the extractor. */
  durationSec?: number;
}

// ── Frame evaluator dependencies (slice-3 spec 3.1) ──

/**
 * What the vision model returns for a frame set. Objective integrity ONLY:
 * artifact flags from the bounded vocabulary, a presence check, and the
 * frame-assessable soft dimensions. `audioNaturalness` is structurally absent
 * (frames carry no audio) and must never be fabricated.
 */
export const VisionQaResultSchema = z.object({
  artifactFlags: z.array(z.string()),
  humanPresent: z.boolean(),
  softScores: z.object({
    visualRealism: z.number().min(0).max(1).optional(),
    behavioralRealism: z.number().min(0).max(1).optional(),
    ugcAuthenticity: z.number().min(0).max(1).optional(),
  }),
  notes: z.string().optional(),
});
export type VisionQaResult = z.infer<typeof VisionQaResultSchema>;

export interface RealismScorerDeps {
  frameExtractor: FrameExtractor;
  vision: (opts: {
    images: string[];
    userMessage: string;
    schema: typeof VisionQaResultSchema;
  }) => Promise<VisionQaResult>;
}

const QA_FLAG_VOCABULARY = [
  "face_drift",
  "product_warp",
  "hand_warp",
  "garbled_text",
  "broken_frame",
  "anatomical_error",
] as const;

/**
 * The QA instruction. Pinned to OBJECTIVE INTEGRITY: artifacts, presence,
 * legibility, cross-frame coherence. The aesthetics prohibition is part of
 * the contract (LLM-as-judge is unreliable for creative aesthetic quality;
 * taste stays human). Exported so a test can pin the prohibition textually.
 */
export function buildQaPrompt(input: RealismScorerInput): string {
  return [
    `You are a technical video-QA inspector. These are evenly spaced frames`,
    `from a generated ad video (${input.specDescription}).`,
    `Assess OBJECTIVE INTEGRITY ONLY:`,
    `- artifactFlags: from this exact vocabulary, only when clearly present: ${QA_FLAG_VOCABULARY.join(", ")}.`,
    `- humanPresent: is a human subject clearly visible in the frames?`,
    `- softScores (0-1, technical integrity, NOT appeal): visualRealism (rendering is`,
    `  photoreal and coherent), behavioralRealism (poses/motion plausible across frames),`,
    `  ugcAuthenticity (handheld-native framing, not studio-artificial).`,
    `Do not judge aesthetic appeal, creative quality, or persuasiveness; that is a human's`,
    `job. Anything else noteworthy goes into notes (it gates nothing).`,
    `Reply with JSON: {"artifactFlags": string[], "humanPresent": boolean,`,
    `"softScores": {"visualRealism"?: number, "behavioralRealism"?: number,`,
    `"ugcAuthenticity"?: number}, "notes"?: string}.`,
  ].join("\n");
}

// ── Weighted soft score ──

/**
 * Weighted soft score, RENORMALIZED over the dimensions actually present
 * (slice-3 contract change, spec 3.1): a frame evaluator cannot honestly
 * score every dimension (frames carry no audio), and absent-as-0 would make
 * `pass` unreachable or arbitrarily harder depending on which dimensions an
 * evaluator can see. All-absent returns 0 (review). The safety gate against
 * fabricated scores is deriveApprovalState's qaStatus check, not this curve.
 */
export function computeWeightedSoftScore(
  softScores: Partial<RealismSoftScores>,
  weights = DEFAULT_QA_THRESHOLDS.softScoreDefaults.weights,
): number {
  const dims: Array<[keyof RealismSoftScores & keyof typeof weights, number | undefined]> = [
    ["visualRealism", softScores.visualRealism],
    ["behavioralRealism", softScores.behavioralRealism],
    ["ugcAuthenticity", softScores.ugcAuthenticity],
    ["audioNaturalness", softScores.audioNaturalness],
  ];
  let weighted = 0;
  let presentWeight = 0;
  for (const [dim, value] of dims) {
    if (value !== undefined) {
      weighted += weights[dim] * value;
      presentWeight += weights[dim];
    }
  }
  return presentWeight > 0 ? weighted / presentWeight : 0;
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

const HONEST_STUB: RealismScore = {
  hardChecks: { artifactFlags: [] },
  softScores: {},
  overallDecision: "review",
  qaStatus: "requires_human_review",
};

/**
 * Realism QA entry point (slice-3 spec 3.1).
 *
 * With `deps` present and the chain succeeding (frames extracted, vision call
 * returns a schema-valid result), the score carries `qaStatus: "evaluated"`,
 * populated hard/soft checks, and a `computeDecision` verdict;
 * `deriveApprovalState` then gates approval on the real result.
 *
 * HONEST-STUB DISCIPLINE: without deps, or on ANY infrastructure shortfall
 * (download/SSRF rejection, ffmpeg failure, vision failure, schema-invalid
 * reply), this returns `qaStatus: "requires_human_review"` so the asset
 * routes to a human; QA infrastructure problems never fabricate a verdict
 * and never block the pipeline.
 */
export async function evaluateRealism(
  input: RealismScorerInput,
  deps?: RealismScorerDeps,
): Promise<RealismScore> {
  if (!deps) return { ...HONEST_STUB };

  let workDir: string | undefined;
  try {
    const extracted = await deps.frameExtractor.extract(
      input.videoUrl,
      input.durationSec ?? 0, // extractor applies its own default clip length
    );
    workDir = extracted.workDir;
    const result = await deps.vision({
      images: extracted.frames,
      userMessage: buildQaPrompt(input),
      schema: VisionQaResultSchema,
    });

    const artifactFlags = [...result.artifactFlags];
    if (input.format === "talking_head" && !result.humanPresent) {
      artifactFlags.push("missing_subject");
    }

    const score: RealismScore = {
      hardChecks: { artifactFlags },
      // audioNaturalness stays structurally absent: frames carry no audio.
      softScores: result.softScores,
      overallDecision: "review",
      qaStatus: "evaluated",
      // Model observations; persisted operator context that gates nothing.
      ...(result.notes ? { notes: result.notes } : {}),
    };
    return { ...score, overallDecision: computeDecision(score, input.thresholds) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`frame QA unavailable for ${input.videoUrl} (routing to human review):`, reason);
    // The degrade reason rides the persisted score so an operator can tell a
    // vision/extraction outage from a genuinely ambiguous clip.
    return { ...HONEST_STUB, notes: `qa unavailable: ${reason}` };
  } finally {
    // The extractor's temp dir (downloaded source + frames, up to the size
    // cap) is consumed entirely within this call; a retry loop without
    // cleanup would fill the host disk. Best-effort, never throws.
    if (workDir) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup only
      }
    }
  }
}
