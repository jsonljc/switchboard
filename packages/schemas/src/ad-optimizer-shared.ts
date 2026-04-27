// Leaf module for shared Zod schemas referenced by both ad-optimizer.ts
// and ad-optimizer-v2.ts. Breaks the runtime A↔B import cycle that PR #264
// surfaced (v2 imports these for AdSetDetailSchema; ad-optimizer.ts uses
// FunnelShapeSchema internally and previously hosted both definitions).
import { z } from "zod";

export const FunnelShapeSchema = z.enum(["website", "instant_form", "whatsapp"]);
export type FunnelShapeSchema = z.infer<typeof FunnelShapeSchema>;

export const LearningStateSchema = z.enum(["learning", "learning_limited", "success", "unknown"]);
export type LearningStateSchema = z.infer<typeof LearningStateSchema>;

export const LearningPhaseStatusSchema = z.object({
  adSetId: z.string(),
  adSetName: z.string(),
  campaignId: z.string(),
  state: LearningStateSchema,
  metricsSnapshot: z
    .object({
      cpa: z.number(),
      roas: z.number(),
      ctr: z.number(),
      spend: z.number(),
      conversions: z.number(),
    })
    .nullable(),
  postExitSnapshot: z
    .object({
      cpa: z.number(),
      roas: z.number(),
      ctr: z.number(),
      spend: z.number(),
      conversions: z.number(),
    })
    .nullable(),
  exitStability: z.enum(["healthy", "unstable", "pending"]).nullable(),
});
export type LearningPhaseStatusSchema = z.infer<typeof LearningPhaseStatusSchema>;
