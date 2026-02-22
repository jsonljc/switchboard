import { z } from "zod";

export const CompetenceEventSchema = z.object({
  type: z.enum(["promoted", "demoted", "score_updated"]),
  timestamp: z.coerce.date(),
  previousScore: z.number(),
  newScore: z.number(),
  reason: z.string(),
});
export type CompetenceEvent = z.infer<typeof CompetenceEventSchema>;

export const CompetenceRecordSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  actionType: z.string(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  rollbackCount: z.number().int().nonnegative(),
  consecutiveSuccesses: z.number().int().nonnegative(),
  score: z.number().nonnegative(),
  lastActivityAt: z.coerce.date(),
  lastDecayAppliedAt: z.coerce.date(),
  history: z.array(CompetenceEventSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CompetenceRecord = z.infer<typeof CompetenceRecordSchema>;

export const CompetenceThresholdsSchema = z.object({
  promotionScore: z.number(),
  promotionMinSuccesses: z.number().int(),
  demotionScore: z.number(),
  successPoints: z.number(),
  failurePoints: z.number(),
  rollbackPoints: z.number(),
  streakBonusPerStep: z.number(),
  streakBonusCap: z.number(),
  decayPointsPerDay: z.number(),
  scoreCeiling: z.number(),
  scoreFloor: z.number(),
});
export type CompetenceThresholds = z.infer<typeof CompetenceThresholdsSchema>;

export const CompetencePolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  actionTypePattern: z.string().nullable(),
  thresholds: CompetenceThresholdsSchema,
  enabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CompetencePolicy = z.infer<typeof CompetencePolicySchema>;

export const CompetenceAdjustmentSchema = z.object({
  principalId: z.string(),
  actionType: z.string(),
  score: z.number(),
  shouldTrust: z.boolean(),
  shouldEscalate: z.boolean(),
  record: CompetenceRecordSchema,
});
export type CompetenceAdjustment = z.infer<typeof CompetenceAdjustmentSchema>;
