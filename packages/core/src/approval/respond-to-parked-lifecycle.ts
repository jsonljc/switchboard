// ---------------------------------------------------------------------------
// Lifecycle-native approval response for parked WorkUnits
// ---------------------------------------------------------------------------
//
// respond-to-approval.ts handles approvals that have a legacy ApprovalRequest
// row. Parked governed-workflow WorkUnits (cron/internal submits, and every
// HTTP propose when lifecycleService is wired) have ONLY an ApprovalLifecycle
// row + WorkTrace; this module is their single respond path.
//
// CONTRACT (spec 4.1/4.2):
// - The payload a human approves is the CURRENT REVISION (binding-hash
//   checked); approveLifecycle freezes it into ExecutableWorkUnit.frozenPayload.
// - The dispatched payload IS that frozen payload: this module writes
//   frozenPayload.parameters onto the WorkTrace (canonical persistence, the
//   same precedent as the legacy patch path) BEFORE dispatch.
// - platformLifecycle.executeApproved(workUnitId) takes the ORIGINAL WorkUnit
//   id (lifecycle.actionEnvelopeId) and dispatches FROM the trace, so by
//   construction it executes exactly the approved payload.
// - The DispatchRecord is keyed by ExecutableWorkUnit.id with deterministic
//   idempotency `lifecycle-dispatch:<lifecycleId>:<revisionId>:attempt-<n>`;
//   the unique key is the double-dispatch lock per attempt.
// - Dispatch failure (throw OR success:false) transitions the lifecycle to
//   "recovery_required" so the operator gets a Retry card; approved governed
//   work must never vanish into logs. Retry is approve-on-recovery_required:
//   it re-validates the binding, transitions back to "approved" (dispatch
//   admission stays strict), and re-dispatches with the next attempt number.

import type { ExecuteResult } from "@switchboard/schemas";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";
import type { LifecycleRecord } from "./lifecycle-types.js";
import type { WorkTrace } from "../platform/work-trace.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { WorkUnit } from "../platform/work-unit.js";
import type { AuditLedger } from "../audit/ledger.js";
import {
  runDispatch,
  writeApprovedPayloadToTrace,
  type ExecuteApprovedLike,
} from "./lifecycle-dispatch.js";

export type { ExecuteApprovedLike } from "./lifecycle-dispatch.js";

export class ParkedLifecycleNotFoundError extends Error {
  readonly code = "not_found";
  constructor(lifecycleId: string) {
    super(`Lifecycle not found: ${lifecycleId}`);
    this.name = "ParkedLifecycleNotFoundError";
  }
}

export class ParkedLifecycleAlreadyRespondedError extends Error {
  readonly code = "already_responded";
  constructor(lifecycleId: string, status: string) {
    super(`Lifecycle ${lifecycleId} has already been responded to (status: ${status})`);
    this.name = "ParkedLifecycleAlreadyRespondedError";
  }
}

export class ParkedLifecycleExpiredError extends Error {
  readonly code = "expired";
  constructor(lifecycleId: string) {
    super(`Lifecycle ${lifecycleId} has expired`);
    this.name = "ParkedLifecycleExpiredError";
  }
}

export interface RespondToParkedLifecycleDeps {
  lifecycleService: ApprovalLifecycleService;
  workTraceStore: WorkTraceStore;
  platformLifecycle: ExecuteApprovedLike;
  auditLedger?: AuditLedger;
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
  selfApprovalAllowed?: boolean;
}

export interface RespondToParkedLifecycleParams {
  lifecycleId: string;
  action: "approve" | "reject";
  respondedBy: string;
  bindingHash?: string;
  /** Optional operator note; recorded in the audit ledger snapshot. */
  note?: string;
}

export interface ParkedApprovalState {
  status: "approved" | "rejected";
  respondedBy: string;
  respondedAt: string;
  lifecycleId: string;
}

export interface RespondToParkedLifecycleResult {
  approvalState: ParkedApprovalState;
  executionResult: ExecuteResult | null;
}

export async function respondToParkedLifecycle(
  deps: RespondToParkedLifecycleDeps,
  params: RespondToParkedLifecycleParams,
): Promise<RespondToParkedLifecycleResult> {
  const { lifecycleService, workTraceStore, auditLedger } = deps;

  const lifecycle = await lifecycleService.getLifecycleById(params.lifecycleId);
  if (!lifecycle) throw new ParkedLifecycleNotFoundError(params.lifecycleId);

  if (lifecycle.status === "recovery_required") {
    if (params.action !== "approve") {
      throw new ParkedLifecycleAlreadyRespondedError(lifecycle.id, lifecycle.status);
    }
    return retryDispatch(deps, params, lifecycle);
  }
  if (lifecycle.status !== "pending") {
    throw new ParkedLifecycleAlreadyRespondedError(lifecycle.id, lifecycle.status);
  }
  if (lifecycle.expiresAt <= new Date()) {
    await lifecycleService.expireLifecycle(lifecycle.id);
    throw new ParkedLifecycleExpiredError(lifecycle.id);
  }

  const traceResult = await workTraceStore.getByWorkUnitId(lifecycle.actionEnvelopeId);
  const trace = traceResult?.trace ?? null;
  const respondedAt = new Date().toISOString();

  if (params.action === "reject") {
    // rejectLifecycle tolerates a missing trace, so a degraded card stays rejectable.
    await lifecycleService.rejectLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: params.respondedBy,
      traceStore: workTraceStore,
      auditLedger,
    });
    await recordLedger(auditLedger, "action.rejected", params, lifecycle, trace);
    return {
      approvalState: {
        status: "rejected",
        respondedBy: params.respondedBy,
        respondedAt,
        lifecycleId: lifecycle.id,
      },
      executionResult: null,
    };
  }

  // --- approve ---
  if (!trace) {
    throw new Error(
      `WorkTrace not found for parked lifecycle ${lifecycle.id} (workUnit ${lifecycle.actionEnvelopeId})`,
    );
  }
  assertNotSelfApproval(deps, params, trace);
  if (!params.bindingHash) throw new Error("bindingHash is required to approve");

  const workUnit = workUnitFromTrace(trace);
  const { lifecycle: approved, executableWorkUnit } = await lifecycleService.approveLifecycle({
    lifecycleId: lifecycle.id,
    respondedBy: params.respondedBy,
    clientBindingHash: params.bindingHash,
    workUnit,
    actionEnvelopeId: lifecycle.actionEnvelopeId,
    constraints: (trace.governanceConstraints as unknown as Record<string, unknown>) ?? {},
  });

  // Payload authority (spec 4.1): the trace MUST carry the approved frozen
  // payload before dispatch — executeAfterApproval dispatches from the trace.
  await writeApprovedPayloadToTrace({
    deps: { workTraceStore },
    lifecycle: approved,
    executableWorkUnit,
    fallbackParameters: workUnit.parameters,
    approvalOutcome: "approved",
    respondedBy: params.respondedBy,
    respondedAt,
    caller: "respond_to_parked_lifecycle",
  });

  const executionResult = await runDispatch(
    deps,
    approved,
    executableWorkUnit.id,
    executableWorkUnit.approvalRevisionId,
  );

  await recordLedger(auditLedger, "action.approved", params, lifecycle, trace);
  deps.logger.info(
    {
      lifecycleId: lifecycle.id,
      workUnitId: lifecycle.actionEnvelopeId,
      success: executionResult.success,
    },
    "Parked lifecycle approved and dispatched",
  );

  return {
    approvalState: {
      status: "approved",
      respondedBy: params.respondedBy,
      respondedAt,
      lifecycleId: lifecycle.id,
    },
    executionResult,
  };
}

async function retryDispatch(
  deps: RespondToParkedLifecycleDeps,
  params: RespondToParkedLifecycleParams,
  lifecycle: LifecycleRecord,
): Promise<RespondToParkedLifecycleResult> {
  if (!params.bindingHash) throw new Error("bindingHash is required to approve");
  const revision = await deps.lifecycleService.getCurrentRevision(lifecycle.id);
  if (!revision || revision.bindingHash !== params.bindingHash) {
    throw new Error("Stale binding: client binding hash does not match current revision");
  }
  const traceResult = await deps.workTraceStore.getByWorkUnitId(lifecycle.actionEnvelopeId);
  if (!traceResult?.trace) {
    throw new Error(`WorkTrace not found for parked lifecycle ${lifecycle.id}`);
  }
  assertNotSelfApproval(deps, params, traceResult.trace);
  if (!lifecycle.currentExecutableWorkUnitId) {
    throw new Error(`Lifecycle ${lifecycle.id} has no executable work unit to retry`);
  }
  // Admission stays strict: only "approved" dispatches. Version-checked, so a
  // raced double-retry loses here (StaleVersionError -> 409 at the route).
  const approved = await deps.lifecycleService.transitionStatus(lifecycle, "approved");
  const executionResult = await runDispatch(
    deps,
    approved,
    lifecycle.currentExecutableWorkUnitId,
    revision.id,
  );
  await recordLedger(deps.auditLedger, "action.approved", params, lifecycle, traceResult.trace);
  return {
    approvalState: {
      status: "approved",
      respondedBy: params.respondedBy,
      respondedAt: new Date().toISOString(),
      lifecycleId: lifecycle.id,
    },
    executionResult,
  };
}

function assertNotSelfApproval(
  deps: RespondToParkedLifecycleDeps,
  params: RespondToParkedLifecycleParams,
  trace: WorkTrace,
): void {
  if (deps.selfApprovalAllowed) return;
  if (trace.actor.id === params.respondedBy) {
    throw new Error("Self-approval is not permitted");
  }
}

function workUnitFromTrace(trace: WorkTrace): WorkUnit {
  return {
    id: trace.workUnitId,
    requestedAt: trace.requestedAt,
    organizationId: trace.organizationId,
    actor: trace.actor,
    intent: trace.intent,
    parameters: trace.parameters ?? {},
    deployment: trace.deploymentContext ?? {
      deploymentId: trace.deploymentId ?? "unresolved",
      skillSlug: trace.intent.split(".")[0] ?? "unknown",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: trace.mode,
    idempotencyKey: trace.idempotencyKey,
    parentWorkUnitId: trace.parentWorkUnitId,
    traceId: trace.traceId,
    trigger: trace.trigger,
    priority: "normal",
  };
}

async function recordLedger(
  ledger: AuditLedger | undefined,
  eventType: "action.approved" | "action.rejected",
  params: RespondToParkedLifecycleParams,
  lifecycle: LifecycleRecord,
  trace: WorkTrace | null,
): Promise<void> {
  if (!ledger) return;
  await ledger.record({
    eventType,
    actorType: "user",
    actorId: params.respondedBy,
    entityType: "action",
    entityId: lifecycle.actionEnvelopeId,
    riskCategory: "medium",
    summary: `${eventType === "action.approved" ? "Parked action approved" : "Parked action rejected"} by ${params.respondedBy}`,
    snapshot: {
      lifecycleId: lifecycle.id,
      intent: trace?.intent ?? "unknown",
      ...(params.note ? { note: params.note } : {}),
    },
    envelopeId: lifecycle.actionEnvelopeId,
    organizationId: lifecycle.organizationId ?? undefined,
    traceId: trace?.traceId,
  });
}
