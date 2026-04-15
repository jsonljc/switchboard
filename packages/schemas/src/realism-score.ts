// packages/schemas/src/realism-score.ts
import { z } from "zod";

export const RealismHardChecks = z.object({
  faceSimilarity: z.number().min(0).max(1).optional(),
  ocrAccuracy: z.number().min(0).max(1).optional(),
  voiceSimilarity: z.number().min(0).max(1).optional(),
  lipSyncScore: z.number().min(0).max(1).optional(),
  artifactFlags: z.array(z.string()),
});
export type RealismHardChecks = z.infer<typeof RealismHardChecks>;

export const RealismSoftScores = z.object({
  visualRealism: z.number().min(0).max(1).optional(),
  behavioralRealism: z.number().min(0).max(1).optional(),
  ugcAuthenticity: z.number().min(0).max(1).optional(),
  audioNaturalness: z.number().min(0).max(1).optional(),
});
export type RealismSoftScores = z.infer<typeof RealismSoftScores>;

export const RealismDecision = z.enum(["pass", "review", "fail"]);
export type RealismDecision = z.infer<typeof RealismDecision>;

export const RealismScoreSchema = z.object({
  hardChecks: RealismHardChecks,
  softScores: RealismSoftScores,
  overallDecision: RealismDecision,
});
export type RealismScore = z.infer<typeof RealismScoreSchema>;
