import type { PrismaClient } from "@prisma/client";
import { mapRowToWorkflow, mapRowToAction, mapRowToCheckpoint } from "./prisma-workflow-mappers.js";
import type {
  WorkflowExecution,
  PendingAction,
  ApprovalCheckpoint,
} from "./prisma-workflow-mappers.js";

// ---------------------------------------------------------------------------
// Enums (local — structural typing, no cross-layer import)
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

type PendingActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "rejected"
  | "expired";

// ---------------------------------------------------------------------------
// Store Interfaces (structural match with @switchboard/core)
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
        const row = await this.prisma.workflowExecution.findUnique({ where: { id } });
        if (!row) return null;
        return mapRowToWorkflow(row);
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

        await this.prisma.workflowExecution.update({ where: { id }, data });
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
        return rows.map(mapRowToWorkflow);
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
        const row = await this.prisma.pendingActionRecord.findUnique({ where: { id } });
        if (!row) return null;
        return mapRowToAction(row);
      },

      update: async (id: string, updates: Partial<PendingAction>): Promise<void> => {
        const data: Record<string, unknown> = {};
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.parameters !== undefined) data.parameters = updates.parameters as object;
        if (updates.resolvedAt !== undefined) data.resolvedAt = updates.resolvedAt;
        if (updates.resolvedBy !== undefined) data.resolvedBy = updates.resolvedBy;

        await this.prisma.pendingActionRecord.update({ where: { id }, data });
      },

      listByWorkflow: async (workflowId: string): Promise<PendingAction[]> => {
        const rows = await this.prisma.pendingActionRecord.findMany({
          where: { workflowId },
          orderBy: { createdAt: "asc" },
        });
        return rows.map(mapRowToAction);
      },

      listByStatus: async (
        organizationId: string,
        status: PendingActionStatus,
        limit?: number,
      ): Promise<PendingAction[]> => {
        const rows = await this.prisma.pendingActionRecord.findMany({
          where: { organizationId, status },
          take: limit,
          orderBy: { createdAt: "asc" },
        });
        return rows.map(mapRowToAction);
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
        const row = await this.prisma.approvalCheckpointRecord.findUnique({ where: { id } });
        if (!row) return null;
        return mapRowToCheckpoint(row);
      },

      getByWorkflowAndStep: async (
        workflowId: string,
        stepIndex: number,
      ): Promise<ApprovalCheckpoint | null> => {
        const row = await this.prisma.approvalCheckpointRecord.findUnique({
          where: { workflowId_stepIndex: { workflowId, stepIndex } },
        });
        if (!row) return null;
        return mapRowToCheckpoint(row);
      },

      update: async (id: string, updates: Partial<ApprovalCheckpoint>): Promise<void> => {
        const data: Record<string, unknown> = {};
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.resolution !== undefined) {
          data.resolution = updates.resolution ? (updates.resolution as object) : undefined;
        }
        await this.prisma.approvalCheckpointRecord.update({ where: { id }, data });
      },

      listPending: async (organizationId: string): Promise<ApprovalCheckpoint[]> => {
        const rows = await this.prisma.approvalCheckpointRecord.findMany({
          where: {
            status: "pending",
            workflow: { organizationId },
          },
          orderBy: { createdAt: "asc" },
        });
        return rows.map(mapRowToCheckpoint);
      },
    };
  }
}
