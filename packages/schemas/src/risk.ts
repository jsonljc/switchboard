import { z } from "zod";

export const RiskCategorySchema = z.enum(["none", "low", "medium", "high", "critical"]);
export type RiskCategory = z.infer<typeof RiskCategorySchema>;

export const ReversibilitySchema = z.enum(["full", "partial", "none"]);
export type Reversibility = z.infer<typeof ReversibilitySchema>;

export const RiskInputSchema = z.object({
  baseRisk: RiskCategorySchema,
  exposure: z.object({
    dollarsAtRisk: z.number().nonnegative(),
    blastRadius: z.number().nonnegative(),
  }),
  reversibility: ReversibilitySchema,
  sensitivity: z.object({
    entityVolatile: z.boolean(),
    learningPhase: z.boolean(),
    recentlyModified: z.boolean(),
  }),
});
export type RiskInput = z.infer<typeof RiskInputSchema>;

export const RiskFactorSchema = z.object({
  factor: z.string(),
  weight: z.number(),
  contribution: z.number(),
  detail: z.string(),
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const RiskScoreSchema = z.object({
  rawScore: z.number().min(0).max(100),
  category: RiskCategorySchema,
  factors: z.array(RiskFactorSchema),
});
export type RiskScore = z.infer<typeof RiskScoreSchema>;

export const CompositeRiskContextSchema = z.object({
  recentActionCount: z.number().int().nonnegative(),
  windowMs: z.number().nonnegative(),
  cumulativeExposure: z.number().nonnegative(),
  distinctTargetEntities: z.number().int().nonnegative(),
  distinctCartridges: z.number().int().nonnegative(),
});
export type CompositeRiskContext = z.infer<typeof CompositeRiskContextSchema>;
