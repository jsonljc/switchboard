import type {
  ApprovalLifecycleStore,
  LifecycleRecord,
  CreateLifecycleInput,
} from "./lifecycle-types.js";
import type { ApprovalRevision, ExecutableWorkUnit } from "@switchboard/schemas";
import type { WorkUnit } from "../platform/work-unit.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import { buildMaterializationInput } from "./executable-materializer.js";
import { validateDispatchAdmission } from "./dispatch-admission.js";

export interface ApprovalLifecycleServiceConfig {
  store: ApprovalLifecycleStore;
}

export class ApprovalLifecycleService {
  private readonly store: ApprovalLifecycleStore;

  constructor(config: ApprovalLifecycleServiceConfig) {
    this.store = config.store;
  }

  async createGatedLifecycle(
    input: CreateLifecycleInput,
  ): Promise<{ lifecycle: LifecycleRecord; revision: ApprovalRevision }> {
    return this.store.createLifecycleWithRevision(input);
  }

  async createRevision(params: {
    lifecycleId: string;
    parametersSnapshot: Record<string, unknown>;
    approvalScopeSnapshot: Record<string, unknown>;
    bindingHash: string;
    createdBy: string;
    sourceBindingHash: string;
    rationale?: string;
  }): Promise<ApprovalRevision> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);
    if (lifecycle.status !== "pending") {
      throw new Error(`Cannot create revision: lifecycle status is "${lifecycle.status}"`);
    }

    const currentRevision = await this.store.getCurrentRevision(params.lifecycleId);
    if (!currentRevision) {
      throw new Error(`No current revision for lifecycle ${params.lifecycleId}`);
    }
    if (currentRevision.bindingHash !== params.sourceBindingHash) {
      throw new Error("Stale binding: source binding hash does not match current revision");
    }

    return this.store.createRevision({
      lifecycleId: params.lifecycleId,
      parametersSnapshot: params.parametersSnapshot,
      approvalScopeSnapshot: params.approvalScopeSnapshot,
      bindingHash: params.bindingHash,
      rationale: params.rationale ?? null,
      supersedesRevisionId: currentRevision.id,
      createdBy: params.createdBy,
    });
  }

  async approveRevision(params: {
    lifecycleId: string;
    respondedBy: string;
    clientBindingHash: string;
    materializationParams: {
      workUnit: WorkUnit;
      actionEnvelopeId: string;
      constraints: Record<string, unknown>;
      executableUntilMs: number;
    };
  }): Promise<{ lifecycle: LifecycleRecord; workUnit: ExecutableWorkUnit }> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);
    if (lifecycle.status !== "pending") {
      throw new Error(`Cannot approve: lifecycle status is "${lifecycle.status}"`);
    }

    const currentRevision = await this.store.getCurrentRevision(params.lifecycleId);
    if (!currentRevision) {
      throw new Error(`No current revision for lifecycle ${params.lifecycleId}`);
    }
    if (currentRevision.bindingHash !== params.clientBindingHash) {
      throw new Error("Stale binding: client binding hash does not match current revision");
    }

    const matInput = buildMaterializationInput({
      revision: currentRevision,
      ...params.materializationParams,
    });

    return this.store.approveAndMaterialize(lifecycle.id, lifecycle.version, matInput);
  }

  async approveLifecycle(params: {
    lifecycleId: string;
    respondedBy: string;
    clientBindingHash: string;
    workUnit: WorkUnit;
    actionEnvelopeId: string;
    constraints: Record<string, unknown>;
    executableUntilMs?: number;
  }): Promise<{ lifecycle: LifecycleRecord; executableWorkUnit: ExecutableWorkUnit }> {
    const { lifecycle, workUnit: executableWorkUnit } = await this.approveRevision({
      lifecycleId: params.lifecycleId,
      respondedBy: params.respondedBy,
      clientBindingHash: params.clientBindingHash,
      materializationParams: {
        workUnit: params.workUnit,
        actionEnvelopeId: params.actionEnvelopeId,
        constraints: params.constraints,
        executableUntilMs: params.executableUntilMs ?? 3600000,
      },
    });

    return { lifecycle, executableWorkUnit };
  }

  async rejectRevision(params: {
    lifecycleId: string;
    respondedBy: string;
  }): Promise<LifecycleRecord> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);
    if (lifecycle.status !== "pending") {
      throw new Error(`Cannot reject: lifecycle status is "${lifecycle.status}"`);
    }

    return this.store.updateLifecycleStatus(lifecycle.id, "rejected", lifecycle.version);
  }

  async rejectLifecycle(params: {
    lifecycleId: string;
    respondedBy: string;
    traceStore: WorkTraceStore;
  }): Promise<LifecycleRecord> {
    const lifecycle = await this.rejectRevision({
      lifecycleId: params.lifecycleId,
      respondedBy: params.respondedBy,
    });

    await params.traceStore.update(lifecycle.actionEnvelopeId, {
      outcome: "failed",
      completedAt: new Date().toISOString(),
      approvalOutcome: "rejected",
      approvalRespondedBy: params.respondedBy,
      approvalRespondedAt: new Date().toISOString(),
    });

    return lifecycle;
  }

  async expireLifecycle(lifecycleId: string): Promise<LifecycleRecord> {
    const lifecycle = await this.store.getLifecycleById(lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${lifecycleId}`);
    if (lifecycle.status !== "pending") return lifecycle;

    return this.store.updateLifecycleStatus(lifecycle.id, "expired", lifecycle.version);
  }

  async listPendingLifecycles(organizationId?: string): Promise<LifecycleRecord[]> {
    const all = await this.store.listPendingLifecycles(organizationId);
    const now = new Date();
    return all.filter((lc) => lc.expiresAt > now);
  }

  async prepareDispatch(params: {
    lifecycleId: string;
    executableWorkUnitId: string;
    idempotencyKey: string;
  }): Promise<{
    lifecycle: LifecycleRecord;
    workUnit: ExecutableWorkUnit;
    dispatchRecord: { id: string; attemptNumber: number };
  }> {
    const lifecycle = await this.store.getLifecycleById(params.lifecycleId);
    if (!lifecycle) throw new Error(`Lifecycle not found: ${params.lifecycleId}`);

    const workUnit = await this.store.getExecutableWorkUnit(params.executableWorkUnitId);
    if (!workUnit) throw new Error(`Work unit not found: ${params.executableWorkUnitId}`);

    validateDispatchAdmission(lifecycle, workUnit);

    const dispatchRecord = await this.store.createDispatchRecord({
      executableWorkUnitId: workUnit.id,
      attemptNumber: 1,
      idempotencyKey: params.idempotencyKey,
    });

    return {
      lifecycle,
      workUnit,
      dispatchRecord: { id: dispatchRecord.id, attemptNumber: dispatchRecord.attemptNumber },
    };
  }

  async recordDispatchOutcome(params: {
    dispatchRecordId: string;
    state: "succeeded" | "failed" | "terminal_failed";
    outcome?: string;
    errorMessage?: string;
    durationMs?: number;
  }): Promise<void> {
    await this.store.updateDispatchRecord(params.dispatchRecordId, {
      state: params.state,
      outcome: params.outcome ?? null,
      errorMessage: params.errorMessage ?? null,
      completedAt: new Date(),
      durationMs: params.durationMs,
    });
  }
}
