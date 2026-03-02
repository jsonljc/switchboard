import { z } from "zod";
import { ActionPlanStrategySchema, ActionPlanApprovalModeSchema } from "./action-plan.js";

export const DataFlowStepSchema = z.object({
  index: z.number().int().nonnegative(),
  cartridgeId: z.string(),
  actionType: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  condition: z.string().nullable(),
});
export type DataFlowStep = z.infer<typeof DataFlowStepSchema>;

export const DataFlowPlanSchema = z.object({
  id: z.string(),
  envelopeId: z.string(),
  strategy: ActionPlanStrategySchema,
  approvalMode: ActionPlanApprovalModeSchema,
  summary: z.string().nullable(),
  steps: z.array(DataFlowStepSchema),
  deferredBindings: z.boolean(),
});
export type DataFlowPlan = z.infer<typeof DataFlowPlanSchema>;

export const StepExecutionResultSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  resolvedParameters: z.record(z.string(), z.unknown()),
  conditionMet: z.boolean(),
  envelopeId: z.string().nullable(),
  outcome: z.enum([
    "executed",
    "denied",
    "pending_approval",
    "skipped_condition",
    "skipped_prior_failure",
    "error",
  ]),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
});
export type StepExecutionResult = z.infer<typeof StepExecutionResultSchema>;
