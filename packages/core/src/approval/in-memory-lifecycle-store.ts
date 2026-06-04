import { randomUUID } from "node:crypto";
import type {
  ApprovalRevision,
  ApprovalLifecycleStatus,
  ExecutableWorkUnit,
  DispatchRecord,
} from "@switchboard/schemas";
import type {
  ApprovalLifecycleStore,
  LifecycleRecord,
  CreateLifecycleInput,
  CreateRevisionInput,
  MaterializeWorkUnitInput,
} from "./lifecycle-types.js";
import { StaleVersionError } from "./state-machine.js";

/**
 * In-memory ApprovalLifecycleStore. TEST/DEV SUPPORT ONLY — production wiring
 * constructs PrismaLifecycleStore exclusively (app.ts gates on prismaClient).
 * Mirrors PrismaLifecycleStore semantics: optimistic version on status updates
 * (StaleVersionError), unique dispatch idempotencyKey, atomic
 * approveAndMaterialize.
 */
export class InMemoryLifecycleStore implements ApprovalLifecycleStore {
  private lifecycles = new Map<string, LifecycleRecord>();
  private revisions = new Map<string, ApprovalRevision>();
  private executables = new Map<string, ExecutableWorkUnit>();
  private dispatches = new Map<string, DispatchRecord>();

  async createLifecycleWithRevision(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }> {
    const now = new Date();
    const lifecycleId = randomUUID();
    const revision: ApprovalRevision = {
      id: randomUUID(),
      lifecycleId,
      revisionNumber: 1,
      parametersSnapshot: input.initialRevision.parametersSnapshot,
      approvalScopeSnapshot: input.initialRevision.approvalScopeSnapshot,
      bindingHash: input.initialRevision.bindingHash,
      rationale: null,
      supersedesRevisionId: null,
      createdBy: input.initialRevision.createdBy,
      createdAt: now,
    };
    const lifecycle: LifecycleRecord = {
      id: lifecycleId,
      actionEnvelopeId: input.actionEnvelopeId,
      organizationId: input.organizationId ?? null,
      status: "pending",
      currentRevisionId: revision.id,
      currentExecutableWorkUnitId: null,
      expiresAt: input.expiresAt,
      pausedSessionId: input.pausedSessionId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.lifecycles.set(lifecycleId, lifecycle);
    this.revisions.set(revision.id, revision);
    return { lifecycle: { ...lifecycle }, revision: { ...revision } };
  }

  async getLifecycleById(id: string): Promise<LifecycleRecord | null> {
    const lc = this.lifecycles.get(id);
    return lc ? { ...lc } : null;
  }

  async getLifecycleByEnvelopeId(envelopeId: string): Promise<LifecycleRecord | null> {
    for (const lc of this.lifecycles.values()) {
      if (lc.actionEnvelopeId === envelopeId) return { ...lc };
    }
    return null;
  }

  async getRevision(lifecycleId: string, revisionNumber: number): Promise<ApprovalRevision | null> {
    for (const rev of this.revisions.values()) {
      if (rev.lifecycleId === lifecycleId && rev.revisionNumber === revisionNumber) {
        return { ...rev };
      }
    }
    return null;
  }

  async getRevisionById(id: string): Promise<ApprovalRevision | null> {
    const rev = this.revisions.get(id);
    return rev ? { ...rev } : null;
  }

  async getCurrentRevision(lifecycleId: string): Promise<ApprovalRevision | null> {
    const lc = this.lifecycles.get(lifecycleId);
    if (!lc?.currentRevisionId) return null;
    return this.getRevisionById(lc.currentRevisionId);
  }

  async createRevision(input: CreateRevisionInput): Promise<ApprovalRevision> {
    let max = 0;
    for (const rev of this.revisions.values()) {
      if (rev.lifecycleId === input.lifecycleId) max = Math.max(max, rev.revisionNumber);
    }
    const revision: ApprovalRevision = {
      id: randomUUID(),
      lifecycleId: input.lifecycleId,
      revisionNumber: max + 1,
      parametersSnapshot: input.parametersSnapshot,
      approvalScopeSnapshot: input.approvalScopeSnapshot,
      bindingHash: input.bindingHash,
      rationale: input.rationale ?? null,
      supersedesRevisionId: input.supersedesRevisionId ?? null,
      createdBy: input.createdBy,
      createdAt: new Date(),
    };
    this.revisions.set(revision.id, revision);
    const lc = this.lifecycles.get(input.lifecycleId);
    if (lc) {
      this.lifecycles.set(lc.id, { ...lc, currentRevisionId: revision.id, updatedAt: new Date() });
    }
    return { ...revision };
  }

  async updateLifecycleStatus(
    id: string,
    status: ApprovalLifecycleStatus,
    expectedVersion: number,
    _organizationId: string | null,
    updates?: { currentRevisionId?: string; currentExecutableWorkUnitId?: string },
  ): Promise<LifecycleRecord> {
    const lc = this.lifecycles.get(id);
    if (!lc || lc.version !== expectedVersion) {
      throw new StaleVersionError(id, expectedVersion, lc?.version ?? -1);
    }
    const next: LifecycleRecord = {
      ...lc,
      status,
      version: expectedVersion + 1,
      updatedAt: new Date(),
      ...(updates?.currentRevisionId ? { currentRevisionId: updates.currentRevisionId } : {}),
      ...(updates?.currentExecutableWorkUnitId
        ? { currentExecutableWorkUnitId: updates.currentExecutableWorkUnitId }
        : {}),
    };
    this.lifecycles.set(id, next);
    return { ...next };
  }

  async materializeWorkUnit(input: MaterializeWorkUnitInput): Promise<ExecutableWorkUnit> {
    const workUnit: ExecutableWorkUnit = {
      id: randomUUID(),
      lifecycleId: input.lifecycleId,
      approvalRevisionId: input.approvalRevisionId,
      actionEnvelopeId: input.actionEnvelopeId,
      frozenPayload: input.frozenPayload,
      frozenBinding: input.frozenBinding,
      frozenExecutionPolicy: input.frozenExecutionPolicy,
      executableUntil: input.executableUntil,
      createdAt: new Date(),
    };
    this.executables.set(workUnit.id, workUnit);
    return { ...workUnit };
  }

  async approveAndMaterialize(
    lifecycleId: string,
    expectedVersion: number,
    organizationId: string | null,
    materializeInput: MaterializeWorkUnitInput,
  ): Promise<{ lifecycle: LifecycleRecord; workUnit: ExecutableWorkUnit }> {
    const workUnit = await this.materializeWorkUnit(materializeInput);
    const lifecycle = await this.updateLifecycleStatus(
      lifecycleId,
      "approved",
      expectedVersion,
      organizationId,
      { currentExecutableWorkUnitId: workUnit.id },
    );
    return { lifecycle, workUnit };
  }

  async getExecutableWorkUnit(id: string): Promise<ExecutableWorkUnit | null> {
    const wu = this.executables.get(id);
    return wu ? { ...wu } : null;
  }

  async createDispatchRecord(input: {
    executableWorkUnitId: string;
    attemptNumber: number;
    idempotencyKey: string;
  }): Promise<DispatchRecord> {
    for (const rec of this.dispatches.values()) {
      if (rec.idempotencyKey === input.idempotencyKey) {
        throw new Error(`Duplicate dispatch idempotencyKey: ${input.idempotencyKey}`);
      }
    }
    const record: DispatchRecord = {
      id: randomUUID(),
      executableWorkUnitId: input.executableWorkUnitId,
      attemptNumber: input.attemptNumber,
      idempotencyKey: input.idempotencyKey,
      state: "dispatching",
      dispatchedAt: new Date(),
      completedAt: null,
      outcome: null,
      errorMessage: null,
      durationMs: null,
    };
    this.dispatches.set(record.id, record);
    return { ...record };
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
    const rec = this.dispatches.get(id);
    if (!rec) throw new Error(`Dispatch record not found: ${id}`);
    const next: DispatchRecord = {
      ...rec,
      state: updates.state as DispatchRecord["state"],
      outcome: updates.outcome ?? rec.outcome,
      errorMessage: updates.errorMessage ?? rec.errorMessage,
      completedAt: updates.completedAt ?? rec.completedAt,
      durationMs: updates.durationMs ?? rec.durationMs,
    };
    this.dispatches.set(id, next);
    return { ...next };
  }

  async listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    return [...this.lifecycles.values()]
      .filter((lc) => lc.status === "pending")
      .filter((lc) => (organizationId ? lc.organizationId === organizationId : true))
      .map((lc) => ({ ...lc }));
  }

  async listExpiredPendingLifecycles(now?: Date): Promise<LifecycleRecord[]> {
    const cutoff = now ?? new Date();
    return [...this.lifecycles.values()]
      .filter((lc) => lc.status === "pending" && lc.expiresAt <= cutoff)
      .map((lc) => ({ ...lc }));
  }

  async listRecoveryRequiredLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    return [...this.lifecycles.values()]
      .filter((lc) => lc.status === "recovery_required")
      .filter((lc) => (organizationId ? lc.organizationId === organizationId : true))
      .map((lc) => ({ ...lc }));
  }

  async countDispatchRecords(executableWorkUnitId: string): Promise<number> {
    return [...this.dispatches.values()].filter(
      (r) => r.executableWorkUnitId === executableWorkUnitId,
    ).length;
  }

  /** Test observability: every dispatch record created so far. */
  listDispatchRecords(): DispatchRecord[] {
    return [...this.dispatches.values()].map((r) => ({ ...r }));
  }
}
