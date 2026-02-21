import { z } from "zod";

export const ActionPlanStrategySchema = z.enum(["atomic", "best_effort", "sequential"]);
export type ActionPlanStrategy = z.infer<typeof ActionPlanStrategySchema>;

export const ActionPlanApprovalModeSchema = z.enum(["per_action", "single_approval"]);
export type ActionPlanApprovalMode = z.infer<typeof ActionPlanApprovalModeSchema>;

export const ActionPlanSchema = z.object({
  id: z.string(),
  envelopeId: z.string(),
  strategy: ActionPlanStrategySchema,
  approvalMode: ActionPlanApprovalModeSchema,
  summary: z.string().nullable(),
  proposalOrder: z.array(z.string()),
});
export type ActionPlan = z.infer<typeof ActionPlanSchema>;
