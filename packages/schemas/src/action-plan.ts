import { z } from "zod";
import {
  DataFlowStepSchema,
  ActionPlanStrategySchema,
  ActionPlanApprovalModeSchema,
} from "./data-flow.js";

export { ActionPlanStrategySchema, ActionPlanApprovalModeSchema };
export type { ActionPlanStrategy, ActionPlanApprovalMode } from "./data-flow.js";

export const ActionPlanSchema = z.object({
  id: z.string(),
  envelopeId: z.string(),
  strategy: ActionPlanStrategySchema,
  approvalMode: ActionPlanApprovalModeSchema,
  summary: z.string().nullable(),
  proposalOrder: z.array(z.string()),
  dataFlowSteps: z.array(DataFlowStepSchema).optional(),
});
export type ActionPlan = z.infer<typeof ActionPlanSchema>;
