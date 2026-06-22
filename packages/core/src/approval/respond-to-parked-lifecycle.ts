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

/**
 * Thrown when an approver-role principal responds to an approval whose revision
 * carries a non-empty `approvalScopeSnapshot.approvers` list that does NOT include
 * them. This is the designated-approver MEMBERSHIP floor — the shared core spine
 * behind both the API respond route and the chat/bridge surface (A16). It is the
 * finer-grained companion to the surface role floor (requireRole /
 * principalHasApproverRole): role = "may approve at all", membership = "is a
 * designated approver for THIS action". Mapped to HTTP 403 by the API route and to
 * the `not_authorized` refusal code on the chat surface.
 */
export class ParkedLifecycleNotAuthorizedError extends Error {
  readonly code = "not_authorized";
  constructor(lifecycleId: string, respondedBy: string) {
    super(`Principal ${respondedBy} is not a designated approver for lifecycle ${lifecycleId}`);
    this.name = "ParkedLifecycleNotAuthorizedError";
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
  await assertApproverMembership(deps, lifecycle.id, params.respondedBy);
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
  await assertApproverMembership(deps, lifecycle.id, params.respondedBy);
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

/** Coerce the revision's `approvalScopeSnapshot.approvers` (typed `unknown`) to a
 * string[] defensively — a malformed snapshot yields an empty (unrestricted) list
 * rather than throwing. */
function coerceApprovers(snapshot: Record<string, unknown> | undefined): string[] {
  const raw = snapshot?.["approvers"];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Designated-approver membership floor (A16). When the CURRENT revision's
 * `approvalScopeSnapshot.approvers` is a non-empty list, only a principal in that
 * list may approve. Empty/absent list = unrestricted (the pilot default,
 * `DEFAULT_ROUTING_CONFIG.defaultApprovers = []`) so nobody is locked out.
 *
 * Defense-in-depth, NOT the primary gate: the surface role floor (requireRole on
 * the API route; principalHasApproverRole on the chat surface) is the always-on,
 * never-fail-open authorization. So if the revision lookup itself FAILS we fail
 * OPEN (log + skip) rather than block a legitimate member on a transient store
 * blip — the role floor still stands. Call only on APPROVE paths, AFTER the
 * self-approval guard, so self-approval (the universal four-eyes invariant) keeps
 * precedence over membership.
 */
async function assertApproverMembership(
  deps: RespondToParkedLifecycleDeps,
  lifecycleId: string,
  respondedBy: string,
): Promise<void> {
  let revision;
  try {
    revision = await deps.lifecycleService.getCurrentRevision(lifecycleId);
  } catch (err) {
    deps.logger.error(
      { err, lifecycleId },
      "Approver-membership check skipped: current-revision lookup failed (role floor still applies)",
    );
    return;
  }
  const approvers = coerceApprovers(revision?.approvalScopeSnapshot);
  if (approvers.length === 0) return;
  if (!approvers.includes(respondedBy)) {
    throw new ParkedLifecycleNotAuthorizedError(lifecycleId, respondedBy);
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
