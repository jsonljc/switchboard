// ---------------------------------------------------------------------------
// Row-to-domain mapping functions for PrismaWorkflowStore
// Extracted to reduce file size and eliminate duplication.
// ---------------------------------------------------------------------------

// Local type aliases matching @switchboard/core store interfaces.
// Structural typing — no cross-layer import.

type WorkflowStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_event"
  | "scheduled"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

type WorkflowTriggerType = "event" | "schedule" | "operator_command" | "agent_initiated";

type PendingActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "rejected"
  | "expired";

type RiskLevel = "low" | "medium" | "high" | "critical";

type ApprovalType = "auto" | "human_review" | "operator_approval";

type WorkflowStepStatus = "pending" | "executing" | "completed" | "failed" | "skipped";

type ApprovalCheckpointStatus = "pending" | "approved" | "rejected" | "modified" | "expired";

export interface WorkflowSafetyEnvelope {
  maxSteps: number;
  maxDollarsAtRisk: number;
  timeoutMs: number;
  maxReplans: number;
}

interface TargetEntity {
  type: string;
  id: string;
}

interface ActionFallback {
  action: string;
  reason: string;
}

export interface WorkflowStep {
  index: number;
  actionId: string;
  dependsOn: number[];
  status: WorkflowStepStatus;
  result: Record<string, unknown> | null;
}

type WorkflowPlanStrategy = "sequential" | "parallel_where_possible";

export interface WorkflowPlan {
  steps: WorkflowStep[];
  strategy: WorkflowPlanStrategy;
  replannedCount: number;
}

export interface WorkflowExecution {
  id: string;
  organizationId: string;
  triggerType: WorkflowTriggerType;
  triggerRef: string | null;
  sourceAgent: string | null;
  status: WorkflowStatus;
  plan: WorkflowPlan;
  currentStepIndex: number;
  safetyEnvelope: WorkflowSafetyEnvelope;
  counters: {
    stepsCompleted: number;
    dollarsAtRisk: number;
    replansUsed: number;
  };
  metadata: Record<string, unknown>;
  traceId: string;
  error: string | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface PendingAction {
  id: string;
  idempotencyKey: string;
  workflowId: string | null;
  stepIndex: number | null;
  status: PendingActionStatus;
  intent: string;
  targetEntities: TargetEntity[];
  parameters: Record<string, unknown>;
  humanSummary: string;
  confidence: number;
  riskLevel: RiskLevel;
  dollarsAtRisk: number;
  requiredCapabilities: string[];
  dryRunSupported: boolean;
  approvalRequired: ApprovalType;
  fallback: ActionFallback | null;
  sourceAgent: string;
  sourceWorkflow: string | null;
  organizationId: string;
  createdAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

interface ApprovalAlternative {
  label: string;
  parameters: Record<string, unknown>;
}

interface ApprovalResolution {
  decidedBy: string;
  decidedAt: Date;
  selectedAlternative: number | null;
  fieldEdits: Record<string, unknown> | null;
}

export interface ApprovalCheckpoint {
  id: string;
  workflowId: string;
  stepIndex: number;
  actionId: string;
  reason: string;
  options: Array<"approve" | "reject" | "modify">;
  modifiableFields: string[];
  alternatives: ApprovalAlternative[];
  notifyChannels: Array<"telegram" | "whatsapp" | "dashboard">;
  status: ApprovalCheckpointStatus;
  resolution: ApprovalResolution | null;
  createdAt: Date;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Row mapper types (Prisma rows are loosely typed)
// ---------------------------------------------------------------------------

interface WorkflowRow {
  id: string;
  organizationId: string;
  triggerType: string;
  triggerRef: string | null;
  sourceAgent: string | null;
  status: string;
  plan: unknown;
  currentStepIndex: number;
  safetyEnvelope: unknown;
  counters: unknown;
  metadata: unknown;
  traceId: string;
  error: string | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

interface ActionRow {
  id: string;
  idempotencyKey: string;
  workflowId: string | null;
  stepIndex: number | null;
  status: string;
  intent: string;
  targetEntities: unknown;
  parameters: unknown;
  humanSummary: string;
  confidence: number;
  riskLevel: string;
  dollarsAtRisk: number;
  requiredCapabilities: string[];
  dryRunSupported: boolean;
  approvalRequired: string;
  fallback: unknown;
  sourceAgent: string;
  sourceWorkflow: string | null;
  organizationId: string;
  createdAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

interface CheckpointRow {
  id: string;
  workflowId: string;
  stepIndex: number;
  actionId: string;
  reason: string;
  options: string[];
  modifiableFields: string[];
  alternatives: unknown;
  notifyChannels: string[];
  status: string;
  resolution: unknown;
  createdAt: Date;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function mapRowToWorkflow(row: WorkflowRow): WorkflowExecution {
  return {
    id: row.id,
    organizationId: row.organizationId,
    triggerType: row.triggerType as WorkflowTriggerType,
    triggerRef: row.triggerRef,
    sourceAgent: row.sourceAgent,
    status: row.status as WorkflowStatus,
    plan: row.plan as unknown as WorkflowPlan,
    currentStepIndex: row.currentStepIndex,
    safetyEnvelope: row.safetyEnvelope as unknown as WorkflowSafetyEnvelope,
    counters: row.counters as unknown as {
      stepsCompleted: number;
      dollarsAtRisk: number;
      replansUsed: number;
    },
    metadata: row.metadata as unknown as Record<string, unknown>,
    traceId: row.traceId,
    error: row.error,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export function mapRowToAction(row: ActionRow): PendingAction {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    workflowId: row.workflowId,
    stepIndex: row.stepIndex,
    status: row.status as PendingActionStatus,
    intent: row.intent,
    targetEntities: row.targetEntities as unknown as TargetEntity[],
    parameters: row.parameters as unknown as Record<string, unknown>,
    humanSummary: row.humanSummary,
    confidence: row.confidence,
    riskLevel: row.riskLevel as RiskLevel,
    dollarsAtRisk: row.dollarsAtRisk,
    requiredCapabilities: row.requiredCapabilities,
    dryRunSupported: row.dryRunSupported,
    approvalRequired: row.approvalRequired as ApprovalType,
    fallback: row.fallback as unknown as ActionFallback | null,
    sourceAgent: row.sourceAgent,
    sourceWorkflow: row.sourceWorkflow,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
  };
}

export function mapRowToCheckpoint(row: CheckpointRow): ApprovalCheckpoint {
  return {
    id: row.id,
    workflowId: row.workflowId,
    stepIndex: row.stepIndex,
    actionId: row.actionId,
    reason: row.reason,
    options: row.options as Array<"approve" | "reject" | "modify">,
    modifiableFields: row.modifiableFields,
    alternatives: row.alternatives as unknown as ApprovalAlternative[],
    notifyChannels: row.notifyChannels as Array<"telegram" | "whatsapp" | "dashboard">,
    status: row.status as ApprovalCheckpointStatus,
    resolution: row.resolution as unknown as ApprovalResolution | null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
