import type { PrismaClient } from "@prisma/client";

// Local type aliases matching @switchboard/core store interfaces.
// Structural typing — no cross-layer import.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Workflow Safety Envelope
// ---------------------------------------------------------------------------

interface WorkflowSafetyEnvelope {
  maxSteps: number;
  maxDollarsAtRisk: number;
  timeoutMs: number;
  maxReplans: number;
}

// ---------------------------------------------------------------------------
// Pending Action
// ---------------------------------------------------------------------------

interface TargetEntity {
  type: string;
  id: string;
}

interface ActionFallback {
  action: string;
  reason: string;
}

interface PendingAction {
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

// ---------------------------------------------------------------------------
// Workflow Plan
// ---------------------------------------------------------------------------

interface WorkflowStep {
  index: number;
  actionId: string;
  dependsOn: number[];
  status: WorkflowStepStatus;
  result: Record<string, unknown> | null;
}

type WorkflowPlanStrategy = "sequential" | "parallel_where_possible";

interface WorkflowPlan {
  steps: WorkflowStep[];
  strategy: WorkflowPlanStrategy;
  replannedCount: number;
}

// ---------------------------------------------------------------------------
// Workflow Execution
// ---------------------------------------------------------------------------

interface WorkflowExecution {
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

// ---------------------------------------------------------------------------
// Approval Checkpoint
// ---------------------------------------------------------------------------

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

interface ApprovalCheckpoint {
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
// Store Interfaces
// ---------------------------------------------------------------------------

interface WorkflowStore {
  create(workflow: WorkflowExecution): Promise<void>;
  getById(id: string): Promise<WorkflowExecution | null>;
  update(id: string, updates: Partial<WorkflowExecution>): Promise<void>;
  list(filter: {
    organizationId?: string;
    status?: WorkflowStatus;
    sourceAgent?: string;
    limit?: number;
  }): Promise<WorkflowExecution[]>;
}

interface PendingActionStore {
  create(action: PendingAction): Promise<void>;
  getById(id: string): Promise<PendingAction | null>;
  update(id: string, updates: Partial<PendingAction>): Promise<void>;
  listByWorkflow(workflowId: string): Promise<PendingAction[]>;
  listByStatus(
    organizationId: string,
    status: PendingActionStatus,
    limit?: number,
  ): Promise<PendingAction[]>;
}

interface ApprovalCheckpointStore {
  create(checkpoint: ApprovalCheckpoint): Promise<void>;
  getById(id: string): Promise<ApprovalCheckpoint | null>;
  getByWorkflowAndStep(workflowId: string, stepIndex: number): Promise<ApprovalCheckpoint | null>;
  update(id: string, updates: Partial<ApprovalCheckpoint>): Promise<void>;
  listPending(organizationId: string): Promise<ApprovalCheckpoint[]>;
}

// ---------------------------------------------------------------------------
// Prisma Store Implementation
// ---------------------------------------------------------------------------

export class PrismaWorkflowStore {
  public readonly workflows: WorkflowStore;
  public readonly actions: PendingActionStore;
  public readonly checkpoints: ApprovalCheckpointStore;

  constructor(private prisma: PrismaClient) {
    this.workflows = {
      create: async (workflow: WorkflowExecution): Promise<void> => {
        await this.prisma.workflowExecution.create({
          data: {
            id: workflow.id,
            organizationId: workflow.organizationId,
            triggerType: workflow.triggerType,
            triggerRef: workflow.triggerRef,
            sourceAgent: workflow.sourceAgent,
            status: workflow.status,
            plan: workflow.plan as object,
            currentStepIndex: workflow.currentStepIndex,
            safetyEnvelope: workflow.safetyEnvelope as object,
            counters: workflow.counters as object,
            metadata: workflow.metadata as object,
            traceId: workflow.traceId,
            error: workflow.error,
            errorCode: workflow.errorCode,
            startedAt: workflow.startedAt,
            completedAt: workflow.completedAt,
          },
        });
      },

      getById: async (id: string): Promise<WorkflowExecution | null> => {
        const row = await this.prisma.workflowExecution.findUnique({
          where: { id },
        });

        if (!row) return null;

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
      },

      update: async (id: string, updates: Partial<WorkflowExecution>): Promise<void> => {
        const data: Record<string, unknown> = {};

        if (updates.status !== undefined) data.status = updates.status;
        if (updates.plan !== undefined) data.plan = updates.plan as object;
        if (updates.currentStepIndex !== undefined)
          data.currentStepIndex = updates.currentStepIndex;
        if (updates.safetyEnvelope !== undefined)
          data.safetyEnvelope = updates.safetyEnvelope as object;
        if (updates.counters !== undefined) data.counters = updates.counters as object;
        if (updates.metadata !== undefined) data.metadata = updates.metadata as object;
        if (updates.error !== undefined) data.error = updates.error;
        if (updates.errorCode !== undefined) data.errorCode = updates.errorCode;
        if (updates.completedAt !== undefined) data.completedAt = updates.completedAt;

        await this.prisma.workflowExecution.update({
          where: { id },
          data,
        });
      },

      list: async (filter: {
        organizationId?: string;
        status?: WorkflowStatus;
        sourceAgent?: string;
        limit?: number;
      }): Promise<WorkflowExecution[]> => {
        const where: Record<string, unknown> = {};

        if (filter.organizationId) where.organizationId = filter.organizationId;
        if (filter.status) where.status = filter.status;
        if (filter.sourceAgent) where.sourceAgent = filter.sourceAgent;

        const rows = await this.prisma.workflowExecution.findMany({
          where,
          take: filter.limit,
          orderBy: { startedAt: "desc" },
        });

        return rows.map((row) => ({
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
        }));
      },
    };

    this.actions = {
      create: async (action: PendingAction): Promise<void> => {
        await this.prisma.pendingActionRecord.create({
          data: {
            id: action.id,
            idempotencyKey: action.idempotencyKey,
            workflowId: action.workflowId,
            stepIndex: action.stepIndex,
            status: action.status,
            intent: action.intent,
            targetEntities: action.targetEntities as object,
            parameters: action.parameters as object,
            humanSummary: action.humanSummary,
            confidence: action.confidence,
            riskLevel: action.riskLevel,
            dollarsAtRisk: action.dollarsAtRisk,
            requiredCapabilities: action.requiredCapabilities,
            dryRunSupported: action.dryRunSupported,
            approvalRequired: action.approvalRequired,
            fallback: action.fallback ? (action.fallback as object) : undefined,
            sourceAgent: action.sourceAgent,
            sourceWorkflow: action.sourceWorkflow,
            organizationId: action.organizationId,
            createdAt: action.createdAt,
            expiresAt: action.expiresAt,
            resolvedAt: action.resolvedAt,
            resolvedBy: action.resolvedBy,
          },
        });
      },

      getById: async (id: string): Promise<PendingAction | null> => {
        const row = await this.prisma.pendingActionRecord.findUnique({
          where: { id },
        });

        if (!row) return null;

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
      },

      update: async (id: string, updates: Partial<PendingAction>): Promise<void> => {
        const data: Record<string, unknown> = {};

        if (updates.status !== undefined) data.status = updates.status;
        if (updates.parameters !== undefined) data.parameters = updates.parameters as object;
        if (updates.resolvedAt !== undefined) data.resolvedAt = updates.resolvedAt;
        if (updates.resolvedBy !== undefined) data.resolvedBy = updates.resolvedBy;

        await this.prisma.pendingActionRecord.update({
          where: { id },
          data,
        });
      },

      listByWorkflow: async (workflowId: string): Promise<PendingAction[]> => {
        const rows = await this.prisma.pendingActionRecord.findMany({
          where: { workflowId },
          orderBy: { createdAt: "asc" },
        });

        return rows.map((row) => ({
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
        }));
      },

      listByStatus: async (
        organizationId: string,
        status: PendingActionStatus,
        limit?: number,
      ): Promise<PendingAction[]> => {
        const rows = await this.prisma.pendingActionRecord.findMany({
          where: {
            organizationId,
            status,
          },
          take: limit,
          orderBy: { createdAt: "asc" },
        });

        return rows.map((row) => ({
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
        }));
      },
    };

    this.checkpoints = {
      create: async (checkpoint: ApprovalCheckpoint): Promise<void> => {
        await this.prisma.approvalCheckpointRecord.create({
          data: {
            id: checkpoint.id,
            workflowId: checkpoint.workflowId,
            stepIndex: checkpoint.stepIndex,
            actionId: checkpoint.actionId,
            reason: checkpoint.reason,
            options: checkpoint.options,
            modifiableFields: checkpoint.modifiableFields,
            alternatives: checkpoint.alternatives as object,
            notifyChannels: checkpoint.notifyChannels,
            status: checkpoint.status,
            resolution: checkpoint.resolution ? (checkpoint.resolution as object) : undefined,
            createdAt: checkpoint.createdAt,
            expiresAt: checkpoint.expiresAt,
          },
        });
      },

      getById: async (id: string): Promise<ApprovalCheckpoint | null> => {
        const row = await this.prisma.approvalCheckpointRecord.findUnique({
          where: { id },
        });

        if (!row) return null;

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
      },

      getByWorkflowAndStep: async (
        workflowId: string,
        stepIndex: number,
      ): Promise<ApprovalCheckpoint | null> => {
        const row = await this.prisma.approvalCheckpointRecord.findUnique({
          where: { workflowId_stepIndex: { workflowId, stepIndex } },
        });

        if (!row) return null;

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
      },

      update: async (id: string, updates: Partial<ApprovalCheckpoint>): Promise<void> => {
        const data: Record<string, unknown> = {};

        if (updates.status !== undefined) data.status = updates.status;
        if (updates.resolution !== undefined) {
          data.resolution = updates.resolution ? (updates.resolution as object) : undefined;
        }

        await this.prisma.approvalCheckpointRecord.update({
          where: { id },
          data,
        });
      },

      listPending: async (organizationId: string): Promise<ApprovalCheckpoint[]> => {
        const rows = await this.prisma.approvalCheckpointRecord.findMany({
          where: {
            status: "pending",
            workflow: {
              organizationId,
            },
          },
          orderBy: { createdAt: "asc" },
        });

        return rows.map((row) => ({
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
        }));
      },
    };
  }
}
