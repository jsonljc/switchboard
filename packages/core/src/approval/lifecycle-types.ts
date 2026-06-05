import type {
  ApprovalLifecycleStatus,
  ApprovalRevision,
  ExecutableWorkUnit,
  DispatchRecord,
} from "@switchboard/schemas";

export interface LifecycleRecord {
  id: string;
  actionEnvelopeId: string;
  organizationId: string | null;
  status: ApprovalLifecycleStatus;
  currentRevisionId: string | null;
  currentExecutableWorkUnitId: string | null;
  expiresAt: Date;
  pausedSessionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLifecycleInput {
  actionEnvelopeId: string;
  organizationId?: string | null;
  expiresAt: Date;
  pausedSessionId?: string | null;
  initialRevision: {
    parametersSnapshot: Record<string, unknown>;
    approvalScopeSnapshot: Record<string, unknown>;
    bindingHash: string;
    createdBy: string;
  };
}

export interface CreateRevisionInput {
  lifecycleId: string;
  /**
   * Organization that owns the lifecycle. Used to scope the WHERE clause when
   * the transaction updates approvalLifecycle.currentRevisionId, providing
   * defense-in-depth past the route-level org check (audit follow-up to
   * TI-7/TI-8).
   */
  organizationId: string | null;
  parametersSnapshot: Record<string, unknown>;
  approvalScopeSnapshot: Record<string, unknown>;
  bindingHash: string;
  rationale?: string | null;
  supersedesRevisionId?: string | null;
  createdBy: string;
}

export { type MaterializeWorkUnitInput } from "./executable-materializer.js";

export interface ApprovalLifecycleStore {
  createLifecycleWithRevision(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }>;

  getLifecycleById(id: string): Promise<LifecycleRecord | null>;
  getLifecycleByEnvelopeId(envelopeId: string): Promise<LifecycleRecord | null>;

  getRevision(lifecycleId: string, revisionNumber: number): Promise<ApprovalRevision | null>;
  getRevisionById(id: string): Promise<ApprovalRevision | null>;
  getCurrentRevision(lifecycleId: string): Promise<ApprovalRevision | null>;

  createRevision(input: CreateRevisionInput): Promise<ApprovalRevision>;

  updateLifecycleStatus(
    id: string,
    status: ApprovalLifecycleStatus,
    expectedVersion: number,
    organizationId: string | null,
    updates?: {
      currentRevisionId?: string;
      currentExecutableWorkUnitId?: string;
    },
  ): Promise<LifecycleRecord>;

  materializeWorkUnit(
    input: import("./executable-materializer.js").MaterializeWorkUnitInput,
  ): Promise<ExecutableWorkUnit>;

  approveAndMaterialize(
    lifecycleId: string,
    expectedVersion: number,
    organizationId: string | null,
    materializeInput: import("./executable-materializer.js").MaterializeWorkUnitInput,
  ): Promise<{ lifecycle: LifecycleRecord; workUnit: ExecutableWorkUnit }>;

  getExecutableWorkUnit(id: string): Promise<ExecutableWorkUnit | null>;

  createDispatchRecord(input: {
    executableWorkUnitId: string;
    attemptNumber: number;
    idempotencyKey: string;
  }): Promise<DispatchRecord>;

  updateDispatchRecord(
    id: string,
    updates: {
      state: string;
      outcome?: string | null;
      errorMessage?: string | null;
      completedAt?: Date;
      durationMs?: number;
    },
  ): Promise<DispatchRecord>;

  listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]>;
  listExpiredPendingLifecycles(now?: Date): Promise<LifecycleRecord[]>;
  /** Lifecycles whose dispatch failed after approval (status "recovery_required"). */
  listRecoveryRequiredLifecycles(organizationId?: string): Promise<LifecycleRecord[]>;
  /** Number of dispatch records ever created for one executable work unit. */
  countDispatchRecords(executableWorkUnitId: string): Promise<number>;
}
