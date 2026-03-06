import { z } from "zod";
import { StepTypeSchema } from "./capability.js";

export const ActionPlanStrategySchema = z.enum(["atomic", "best_effort", "sequential"]);
export type ActionPlanStrategy = z.infer<typeof ActionPlanStrategySchema>;

export const ActionPlanApprovalModeSchema = z.enum(["per_action", "single_approval"]);
export type ActionPlanApprovalMode = z.infer<typeof ActionPlanApprovalModeSchema>;

export const DataFlowStepSchema = z.object({
  index: z.number().int().nonnegative(),
  cartridgeId: z.string(),
  actionType: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  condition: z.string().nullable(),
  /** Semantic step type for plan decomposition and model routing */
  stepType: StepTypeSchema.optional(),
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
