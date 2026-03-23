import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const WorkflowStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "awaiting_event",
  "scheduled",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const TERMINAL_WORKFLOW_STATUSES: WorkflowStatus[] = ["completed", "failed", "cancelled"];

export const WorkflowTriggerTypeSchema = z.enum([
  "event",
  "schedule",
  "operator_command",
  "agent_initiated",
]);
export type WorkflowTriggerType = z.infer<typeof WorkflowTriggerTypeSchema>;

export const PendingActionStatusSchema = z.enum([
  "proposed",
  "approved",
  "executing",
  "completed",
  "failed",
  "rejected",
  "expired",
]);
export type PendingActionStatus = z.infer<typeof PendingActionStatusSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ApprovalTypeSchema = z.enum(["auto", "human_review", "operator_approval"]);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

export const WorkflowStepStatusSchema = z.enum([
  "pending",
  "executing",
  "completed",
  "failed",
  "skipped",
]);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;

export const ApprovalCheckpointStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "modified",
  "expired",
]);
export type ApprovalCheckpointStatus = z.infer<typeof ApprovalCheckpointStatusSchema>;

// ---------------------------------------------------------------------------
// Workflow Safety Envelope
// ---------------------------------------------------------------------------

export const WorkflowSafetyEnvelopeSchema = z.object({
  maxSteps: z.number().int().positive(),
  maxDollarsAtRisk: z.number().nonnegative(),
  timeoutMs: z.number().int().positive(),
  maxReplans: z.number().int().nonnegative(),
});
export type WorkflowSafetyEnvelope = z.infer<typeof WorkflowSafetyEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Pending Action
// ---------------------------------------------------------------------------

export const PendingActionSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  workflowId: z.string().uuid().nullable(),
  stepIndex: z.number().int().nonnegative().nullable(),
  status: PendingActionStatusSchema,
  intent: z.string().min(1),
  targetEntities: z.array(
    z.object({
      type: z.string(),
      id: z.string(),
    }),
  ),
  parameters: z.record(z.unknown()),
  humanSummary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  riskLevel: RiskLevelSchema,
  dollarsAtRisk: z.number().nonnegative(),
  requiredCapabilities: z.array(z.string()),
  dryRunSupported: z.boolean(),
  approvalRequired: ApprovalTypeSchema,
  fallback: z
    .object({
      action: z.string(),
      reason: z.string(),
    })
    .nullable(),
  sourceAgent: z.string().min(1),
  sourceWorkflow: z.string().uuid().nullable(),
  organizationId: z.string().min(1),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  resolvedBy: z.string().nullable(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

// ---------------------------------------------------------------------------
// Workflow Plan
// ---------------------------------------------------------------------------

export const WorkflowStepSchema = z.object({
  index: z.number().int().nonnegative(),
  actionId: z.string().uuid(),
  dependsOn: z.array(z.number().int().nonnegative()),
  status: WorkflowStepStatusSchema,
  result: z.record(z.unknown()).nullable(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowPlanStrategySchema = z.enum(["sequential", "parallel_where_possible"]);
export type WorkflowPlanStrategy = z.infer<typeof WorkflowPlanStrategySchema>;

export const WorkflowPlanSchema = z.object({
  steps: z.array(WorkflowStepSchema),
  strategy: WorkflowPlanStrategySchema,
  replannedCount: z.number().int().nonnegative(),
});
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

// ---------------------------------------------------------------------------
// Workflow Execution
// ---------------------------------------------------------------------------

export const WorkflowExecutionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  triggerType: WorkflowTriggerTypeSchema,
  triggerRef: z.string().nullable(),
  sourceAgent: z.string().nullable(),
  status: WorkflowStatusSchema,
  plan: WorkflowPlanSchema,
  currentStepIndex: z.number().int().nonnegative(),
  safetyEnvelope: WorkflowSafetyEnvelopeSchema,
  counters: z.object({
    stepsCompleted: z.number().int().nonnegative(),
    dollarsAtRisk: z.number().nonnegative(),
    replansUsed: z.number().int().nonnegative(),
  }),
  metadata: z.record(z.unknown()),
  traceId: z.string().min(1),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

// ---------------------------------------------------------------------------
// Approval Checkpoint
// ---------------------------------------------------------------------------

export const ApprovalCheckpointSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  actionId: z.string().uuid(),
  reason: z.string().min(1),
  options: z.array(z.enum(["approve", "reject", "modify"])),
  modifiableFields: z.array(z.string()),
  alternatives: z.array(
    z.object({
      label: z.string(),
      parameters: z.record(z.unknown()),
    }),
  ),
  notifyChannels: z.array(z.enum(["telegram", "whatsapp", "dashboard"])),
  status: ApprovalCheckpointStatusSchema,
  resolution: z
    .object({
      decidedBy: z.string(),
      decidedAt: z.coerce.date(),
      selectedAlternative: z.number().int().nonnegative().nullable(),
      fieldEdits: z.record(z.unknown()).nullable(),
    })
    .nullable(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});
export type ApprovalCheckpoint = z.infer<typeof ApprovalCheckpointSchema>;
