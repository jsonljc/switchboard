import { z } from "zod";
import { ConversationOracleSchema } from "./oracle.js";

/**
 * Funnel/agent stage a scenario primarily exercises. Optional — used by the
 * matrix-coverage test to assert the suite spans the funnel. `full-arc` is a
 * single multi-turn fixture walking discovery → objection → qualification →
 * booking.
 */
export const ConversationStageSchema = z.enum([
  "discovery",
  "objection",
  "qualification",
  "booking",
  "post-booking",
  "safety",
  "refusal",
  "reactivation",
  "full-arc",
]);
export type ConversationStage = z.infer<typeof ConversationStageSchema>;

export const LeadTurnSchema = z.object({ role: z.literal("lead"), content: z.string().min(1) });
export const GradeSpecSchema = z.object({
  mustAsk: z.array(z.string()).default([]),
  mustDo: z.array(z.string()).default([]),
  mustNot: z.array(z.string()).default([]),
  shouldDo: z.array(z.string()).default([]),
});
export const AlexTurnSchema = z.object({ role: z.literal("alex"), grade: GradeSpecSchema });

export const ConversationFixtureSchema = z
  .object({
    id: z.string().min(1),
    vertical: z.literal("medspa"),
    locale: z.enum(["sg", "my"]),
    scenario: z.string().min(1),
    turns: z.array(z.union([LeadTurnSchema, AlexTurnSchema])).min(2),
    /** Optional funnel/agent stage (matrix coverage). Backward compatible. */
    stage: ConversationStageSchema.optional(),
    /** Optional free-form tags (concern axes, edge dimensions). */
    tags: z.array(z.string()).optional(),
    /** Optional machine-checkable trajectory oracle (see oracle.ts). */
    oracle: ConversationOracleSchema.optional(),
  })
  .refine((f) => f.turns[f.turns.length - 1]?.role === "alex", "fixture must end on an alex turn")
  .refine((f) => f.turns[0]?.role === "lead", "fixture must start on a lead turn");
export type ConversationFixture = z.infer<typeof ConversationFixtureSchema>;

export const ClaimWarningSchema = z.object({
  claimType: z.string(),
  confidence: z.number(),
  sentence: z.string(),
});

export const ScenarioBaselineSchema = z.object({
  id: z.string(),
  deterministicPass: z.boolean(),
  judgeScore: z.number().min(0).max(5),
  requiredBehaviorsMet: z.array(z.string()),
  violations: z.array(z.string()),
  /**
   * Advisory claim warnings from the per-sentence classifier. Informational
   * only — stored in the baseline for observability, but never gate regression.
   */
  claimWarnings: z.array(ClaimWarningSchema).optional(),
});
export const BaselineSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  skillContentHash: z.string().min(1),
  judgeRubricVersion: z.string().min(1),
  judgeScoreTolerance: z.number().min(0).max(5),
  scenarios: z.array(ScenarioBaselineSchema),
});
export type Baseline = z.infer<typeof BaselineSchema>;
