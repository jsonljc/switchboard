// ---------------------------------------------------------------------------
// Conversation Flow Schema — Zod-validated flow definitions
// ---------------------------------------------------------------------------

import { z } from "zod";

export const FlowStepTypeSchema = z.enum([
  "message",
  "question",
  "branch",
  "wait",
  "action",
  "escalate",
  "score",
  "objection",
]);
export type FlowStepType = z.infer<typeof FlowStepTypeSchema>;

export const BranchConditionSchema = z.object({
  variable: z.string().min(1),
  operator: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in"]),
  value: z.unknown(),
  targetStepId: z.string().min(1),
});
export type BranchCondition = z.infer<typeof BranchConditionSchema>;

export const FlowStepSchema = z.object({
  id: z.string().min(1),
  type: FlowStepTypeSchema,
  template: z.string().optional(),
  options: z.array(z.string()).optional(),
  branches: z.array(BranchConditionSchema).optional(),
  actionType: z.string().optional(),
  actionParameters: z.record(z.string(), z.unknown()).optional(),
  waitMs: z.number().optional(),
  nextStepId: z.string().optional(),
  llmPersonalization: z.boolean().optional(),
  escalationReason: z.string().optional(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  steps: z.array(FlowStepSchema).min(1),
  variables: z.array(z.string()),
});
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;

export const FlowStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  flowId: z.string().min(1),
  triggerConditions: z.array(BranchConditionSchema).optional(),
});
export type FlowStage = z.infer<typeof FlowStageSchema>;

export const FlowConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),
  stages: z.array(FlowStageSchema).optional(),
  flows: z.array(FlowDefinitionSchema).min(1),
  defaultFlowId: z.string().min(1),
  globalRules: z
    .object({
      maxTurns: z.number().positive().optional(),
      sessionTimeoutMs: z.number().positive().optional(),
      fallbackStrategy: z.enum(["escalate", "retry", "ignore"]).optional(),
    })
    .optional(),
  triggerChannels: z.array(z.string()).optional(),
});
export type FlowConfig = z.infer<typeof FlowConfigSchema>;
