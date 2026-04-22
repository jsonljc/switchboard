import type { PrismaClient } from "@prisma/client";
import type {
  ApprovalLifecycleStore,
  LifecycleRecord,
  CreateLifecycleInput,
  CreateRevisionInput,
  MaterializeWorkUnitInput,
} from "@switchboard/core/approval";
import type {
  ApprovalLifecycleStatus,
  ApprovalRevision,
  ExecutableWorkUnit,
  DispatchRecord,
} from "@switchboard/schemas";
import { StaleVersionError } from "@switchboard/core";
import { randomUUID } from "node:crypto";

export class PrismaLifecycleStore implements ApprovalLifecycleStore {
  constructor(private prisma: PrismaClient) {}

  async createLifecycleWithRevision(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }> {
    const lifecycleId = randomUUID();
    const revisionId = randomUUID();

    const [lcRow, revRow] = await this.prisma.$transaction([
      this.prisma.approvalLifecycle.create({
        data: {
          id: lifecycleId,
          actionEnvelopeId: input.actionEnvelopeId,
          organizationId: input.organizationId ?? null,
          status: "pending",
          currentRevisionId: revisionId,
          currentExecutableWorkUnitId: null,
          expiresAt: input.expiresAt,
          pausedSessionId: input.pausedSessionId ?? null,
          version: 1,
        },
      }),
      this.prisma.approvalRevision.create({
        data: {
          id: revisionId,
          lifecycleId,
          revisionNumber: 1,
          parametersSnapshot: input.initialRevision.parametersSnapshot as object,
          approvalScopeSnapshot: input.initialRevision.approvalScopeSnapshot as object,
          bindingHash: input.initialRevision.bindingHash,
          rationale: null,
          supersedesRevisionId: null,
          createdBy: input.initialRevision.createdBy,
        },
      }),
    ]);

    return {
      lifecycle: toLifecycleRecord(lcRow),
      revision: toRevision(revRow),
    };
  }

  async getLifecycleById(id: string): Promise<LifecycleRecord | null> {
    const row = await this.prisma.approvalLifecycle.findUnique({ where: { id } });
    return row ? toLifecycleRecord(row) : null;
  }

  async getLifecycleByEnvelopeId(envelopeId: string): Promise<LifecycleRecord | null> {
    const row = await this.prisma.approvalLifecycle.findUnique({
      where: { actionEnvelopeId: envelopeId },
    });
    return row ? toLifecycleRecord(row) : null;
  }

  async getRevision(lifecycleId: string, revisionNumber: number): Promise<ApprovalRevision | null> {
    const row = await this.prisma.approvalRevision.findUnique({
      where: { lifecycleId_revisionNumber: { lifecycleId, revisionNumber } },
    });
    return row ? toRevision(row) : null;
  }

  async getRevisionById(id: string): Promise<ApprovalRevision | null> {
    const row = await this.prisma.approvalRevision.findUnique({ where: { id } });
    return row ? toRevision(row) : null;
  }

  async getCurrentRevision(lifecycleId: string): Promise<ApprovalRevision | null> {
    const lc = await this.prisma.approvalLifecycle.findUnique({ where: { id: lifecycleId } });
    if (!lc?.currentRevisionId) return null;
    return this.getRevisionById(lc.currentRevisionId);
  }

  async createRevision(input: CreateRevisionInput): Promise<ApprovalRevision> {
    const latestRev = await this.prisma.approvalRevision.findFirst({
      where: { lifecycleId: input.lifecycleId },
      orderBy: { revisionNumber: "desc" },
    });

    const nextNumber = (latestRev?.revisionNumber ?? 0) + 1;
    const revisionId = randomUUID();

    const [revRow] = await this.prisma.$transaction([
      this.prisma.approvalRevision.create({
        data: {
          id: revisionId,
          lifecycleId: input.lifecycleId,
          revisionNumber: nextNumber,
          parametersSnapshot: input.parametersSnapshot as object,
          approvalScopeSnapshot: input.approvalScopeSnapshot as object,
          bindingHash: input.bindingHash,
          rationale: input.rationale ?? null,
          supersedesRevisionId: input.supersedesRevisionId ?? null,
          createdBy: input.createdBy,
        },
      }),
      this.prisma.approvalLifecycle.update({
        where: { id: input.lifecycleId },
        data: { currentRevisionId: revisionId },
      }),
    ]);

    return toRevision(revRow);
  }

  async updateLifecycleStatus(
    id: string,
    status: ApprovalLifecycleStatus,
    expectedVersion: number,
    updates?: {
      currentRevisionId?: string;
      currentExecutableWorkUnitId?: string;
    },
  ): Promise<LifecycleRecord> {
    const result = await this.prisma.approvalLifecycle.updateMany({
      where: { id, version: expectedVersion },
      data: {
        status,
        version: expectedVersion + 1,
        ...(updates?.currentRevisionId !== undefined
          ? { currentRevisionId: updates.currentRevisionId }
          : {}),
        ...(updates?.currentExecutableWorkUnitId !== undefined
          ? { currentExecutableWorkUnitId: updates.currentExecutableWorkUnitId }
          : {}),
      },
    });

    if (result.count === 0) {
      throw new StaleVersionError(id, expectedVersion, -1);
    }

    const updated = await this.prisma.approvalLifecycle.findUniqueOrThrow({ where: { id } });
    return toLifecycleRecord(updated);
  }

  async materializeWorkUnit(input: MaterializeWorkUnitInput): Promise<ExecutableWorkUnit> {
    const workUnitId = randomUUID();

    const row = await this.prisma.executableWorkUnit.create({
      data: {
        id: workUnitId,
        lifecycleId: input.lifecycleId,
        approvalRevisionId: input.approvalRevisionId,
        actionEnvelopeId: input.actionEnvelopeId,
        frozenPayload: input.frozenPayload as object,
        frozenBinding: input.frozenBinding as object,
        frozenExecutionPolicy: input.frozenExecutionPolicy as object,
        executableUntil: input.executableUntil,
      },
    });

    return toExecutableWorkUnit(row);
  }

  async getExecutableWorkUnit(id: string): Promise<ExecutableWorkUnit | null> {
    const row = await this.prisma.executableWorkUnit.findUnique({ where: { id } });
    return row ? toExecutableWorkUnit(row) : null;
  }

  async createDispatchRecord(input: {
    executableWorkUnitId: string;
    attemptNumber: number;
    idempotencyKey: string;
  }): Promise<DispatchRecord> {
    const row = await this.prisma.dispatchRecord.create({
      data: {
        id: randomUUID(),
        executableWorkUnitId: input.executableWorkUnitId,
        attemptNumber: input.attemptNumber,
        idempotencyKey: input.idempotencyKey,
        state: "dispatching",
      },
    });
    return toDispatchRecord(row);
  }

  async updateDispatchRecord(
    id: string,
    updates: {
      state: string;
      outcome?: string | null;
      errorMessage?: string | null;
      completedAt?: Date;
      durationMs?: number;
    },
  ): Promise<DispatchRecord> {
    const row = await this.prisma.dispatchRecord.update({
      where: { id },
      data: {
        state: updates.state,
        outcome: updates.outcome ?? undefined,
        errorMessage: updates.errorMessage ?? undefined,
        completedAt: updates.completedAt ?? undefined,
        durationMs: updates.durationMs ?? undefined,
      },
    });
    return toDispatchRecord(row);
  }

  async listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    const rows = await this.prisma.approvalLifecycle.findMany({
      where: {
        status: "pending",
        ...(organizationId ? { organizationId } : {}),
      },
    });
    return rows.map(toLifecycleRecord);
  }

  async listExpiredPendingLifecycles(now?: Date): Promise<LifecycleRecord[]> {
    const cutoff = now ?? new Date();
    const rows = await this.prisma.approvalLifecycle.findMany({
      where: {
        status: "pending",
        expiresAt: { lte: cutoff },
      },
    });
    return rows.map(toLifecycleRecord);
  }
}

function toLifecycleRecord(row: {
  id: string;
  actionEnvelopeId: string;
  organizationId: string | null;
  status: string;
  currentRevisionId: string | null;
  currentExecutableWorkUnitId: string | null;
  expiresAt: Date;
  pausedSessionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): LifecycleRecord {
  return {
    id: row.id,
    actionEnvelopeId: row.actionEnvelopeId,
    organizationId: row.organizationId,
    status: row.status as ApprovalLifecycleStatus,
    currentRevisionId: row.currentRevisionId,
    currentExecutableWorkUnitId: row.currentExecutableWorkUnitId,
    expiresAt: row.expiresAt,
    pausedSessionId: row.pausedSessionId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRevision(row: {
  id: string;
  lifecycleId: string;
  revisionNumber: number;
  parametersSnapshot: unknown;
  approvalScopeSnapshot: unknown;
  bindingHash: string;
  rationale: string | null;
  supersedesRevisionId: string | null;
  createdBy: string;
  createdAt: Date;
}): ApprovalRevision {
  return {
    id: row.id,
    lifecycleId: row.lifecycleId,
    revisionNumber: row.revisionNumber,
    parametersSnapshot: row.parametersSnapshot as Record<string, unknown>,
    approvalScopeSnapshot: row.approvalScopeSnapshot as Record<string, unknown>,
    bindingHash: row.bindingHash,
    rationale: row.rationale,
    supersedesRevisionId: row.supersedesRevisionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toExecutableWorkUnit(row: {
  id: string;
  lifecycleId: string;
  approvalRevisionId: string;
  actionEnvelopeId: string;
  frozenPayload: unknown;
  frozenBinding: unknown;
  frozenExecutionPolicy: unknown;
  executableUntil: Date;
  createdAt: Date;
}): ExecutableWorkUnit {
  return {
    id: row.id,
    lifecycleId: row.lifecycleId,
    approvalRevisionId: row.approvalRevisionId,
    actionEnvelopeId: row.actionEnvelopeId,
    frozenPayload: row.frozenPayload as Record<string, unknown>,
    frozenBinding: row.frozenBinding as Record<string, unknown>,
    frozenExecutionPolicy: row.frozenExecutionPolicy as Record<string, unknown>,
    executableUntil: row.executableUntil,
    createdAt: row.createdAt,
  };
}

function toDispatchRecord(row: {
  id: string;
  executableWorkUnitId: string;
  attemptNumber: number;
  idempotencyKey: string;
  state: string;
  dispatchedAt: Date;
  completedAt: Date | null;
  outcome: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}): DispatchRecord {
  return {
    id: row.id,
    executableWorkUnitId: row.executableWorkUnitId,
    attemptNumber: row.attemptNumber,
    idempotencyKey: row.idempotencyKey,
    state: row.state as DispatchRecord["state"],
    dispatchedAt: row.dispatchedAt,
    completedAt: row.completedAt,
    outcome: row.outcome,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
  };
}
