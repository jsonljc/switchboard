// ---------------------------------------------------------------------------
// Shared lifecycle dispatch engine
// ---------------------------------------------------------------------------
//
// The invariant-bearing leg of every approve path: once a lifecycle is
// approved, the system MUST either execute the frozen payload or expose the
// failed execution for recovery (status "recovery_required"). Extracted from
// respond-to-parked-lifecycle.ts so the legacy-row fork
// (respond-via-lifecycle.ts) drives the SAME chain.
//
// CONTRACT (parked-approvals spec 4.1/4.2/4.4; chat-approval-seam spec 2.1):
// - writeApprovedPayloadToTrace commits ExecutableWorkUnit.frozenPayload
//   .parameters onto the WorkTrace (canonical persistence) BEFORE dispatch.
//   executeApproved dispatches FROM the trace, so by construction it executes
//   exactly the approved payload.
// - runDispatch creates a durable DispatchRecord with the deterministic
//   idempotency key `lifecycle-dispatch:<lifecycleId>:<revisionId>:attempt-<n>`
//   (the double-dispatch lock per attempt), then executeApproved, then
//   recordDispatchOutcome. Dispatch failure (throw OR success:false)
//   transitions the lifecycle to "recovery_required" so the operator gets a
//   Retry card; approved governed work must never vanish into logs.

import type { ExecuteResult, ExecutableWorkUnit } from "@switchboard/schemas";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";
import type { LifecycleRecord } from "./lifecycle-types.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { AuditLedger } from "../audit/ledger.js";

export interface ExecuteApprovedLike {
  executeApproved(workUnitId: string): Promise<ExecuteResult>;
}

export interface LifecycleDispatchDeps {
  lifecycleService: ApprovalLifecycleService;
  platformLifecycle: ExecuteApprovedLike;
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
}

/**
 * Payload authority (spec 4.1): the trace MUST carry the approved frozen
 * payload before dispatch. Throws when the trace store rejects the update
 * (integrity-locked trace): the lifecycle stays approved but undispatched;
 * the store's own audit + operator alert is the operator-facing record.
 */
export async function writeApprovedPayloadToTrace(args: {
  deps: { workTraceStore: WorkTraceStore };
  lifecycle: LifecycleRecord;
  executableWorkUnit: ExecutableWorkUnit;
  fallbackParameters: Record<string, unknown>;
  approvalOutcome: "approved" | "patched";
  respondedBy: string;
  respondedAt: string;
  caller: string;
}): Promise<void> {
  const { deps, lifecycle, executableWorkUnit } = args;
  const frozenParameters =
    (executableWorkUnit.frozenPayload["parameters"] as Record<string, unknown> | undefined) ??
    args.fallbackParameters;
  const traceUpdate = await deps.workTraceStore.update(
    lifecycle.actionEnvelopeId,
    {
      parameters: frozenParameters,
      // Proof-chain link (A7 rank5): stamp the approval lifecycle id so the receipted-booking
      // view's humanApprovalId resolves. approvalId is a one-shot trace field (work-trace-lock.ts),
      // undefined on the parked path until this write, so first-set is allowed and a retry with the
      // same lifecycle.id is idempotent (isEqual => not rejected), exactly like the approval* fields.
      approvalId: lifecycle.id,
      approvalOutcome: args.approvalOutcome,
      approvalRespondedBy: args.respondedBy,
      approvalRespondedAt: args.respondedAt,
    },
    {
      caller: args.caller,
      organizationId: lifecycle.organizationId ?? undefined,
    },
  );
  if (!traceUpdate.ok) {
    throw new Error(`WorkTrace update rejected before dispatch: ${traceUpdate.reason}`);
  }
}

/**
 * Resilient payload-commit (P2-16): the ONLY way the approve paths should commit
 * the frozen payload to the trace. Approval-is-lifecycle-state is a core invariant
 * — a lifecycle that is already "approved" must NEVER be left stranded with no
 * committed payload and no dispatch. writeApprovedPayloadToTrace throws on a
 * rejected/integrity-locked trace; if it does, this compensates symmetrically with
 * the dispatch-failure path (runDispatch -> markRecoveryRequired):
 *   1. transition approved -> recovery_required (operator Retry card; sweep-visible),
 *   2. write an operator-visible action.failed audit so the failure is on the record,
 *   3. rethrow so the respond reports failure honestly (route returns an error, not a
 *      false success).
 * The happy path is a pass-through and reaches dispatch unchanged.
 */
export async function commitApprovedPayloadOrRecover(args: {
  deps: {
    workTraceStore: WorkTraceStore;
    lifecycleService: ApprovalLifecycleService;
    auditLedger?: AuditLedger;
    logger: LifecycleDispatchDeps["logger"];
  };
  lifecycle: LifecycleRecord;
  executableWorkUnit: ExecutableWorkUnit;
  fallbackParameters: Record<string, unknown>;
  approvalOutcome: "approved" | "patched";
  respondedBy: string;
  respondedAt: string;
  caller: string;
}): Promise<void> {
  try {
    await writeApprovedPayloadToTrace({
      deps: { workTraceStore: args.deps.workTraceStore },
      lifecycle: args.lifecycle,
      executableWorkUnit: args.executableWorkUnit,
      fallbackParameters: args.fallbackParameters,
      approvalOutcome: args.approvalOutcome,
      respondedBy: args.respondedBy,
      respondedAt: args.respondedAt,
      caller: args.caller,
    });
  } catch (err) {
    await markRecoveryRequired(
      { lifecycleService: args.deps.lifecycleService, logger: args.deps.logger },
      args.lifecycle.id,
    );
    await recordPayloadCommitFailureAudit(args.deps, args.lifecycle, args.respondedBy, err);
    throw err;
  }
}

/**
 * Best-effort operator-visible record of a payload-commit failure. action.failed is
 * in OPERATIONAL_AUDIT_EVENT_TYPES, so it surfaces on the /activity feed. An audit
 * write failure must never mask the original payload-commit error, so it is logged
 * and swallowed here (the caller rethrows the original error).
 */
async function recordPayloadCommitFailureAudit(
  deps: { auditLedger?: AuditLedger; logger: LifecycleDispatchDeps["logger"] },
  lifecycle: LifecycleRecord,
  respondedBy: string,
  err: unknown,
): Promise<void> {
  if (!deps.auditLedger) return;
  try {
    await deps.auditLedger.record({
      eventType: "action.failed",
      actorType: "user",
      actorId: respondedBy,
      entityType: "action",
      entityId: lifecycle.actionEnvelopeId,
      riskCategory: "medium",
      summary:
        "Approved payload commit to WorkTrace failed before dispatch; routed to recovery_required",
      snapshot: {
        lifecycleId: lifecycle.id,
        stage: "write_approved_payload_to_trace",
        reason: err instanceof Error ? err.message : String(err),
      },
      envelopeId: lifecycle.actionEnvelopeId,
      organizationId: lifecycle.organizationId ?? undefined,
    });
  } catch (auditErr) {
    deps.logger.error(
      {
        lifecycleId: lifecycle.id,
        auditErr: auditErr instanceof Error ? auditErr.message : String(auditErr),
      },
      "Failed to write payload-commit-failure audit",
    );
  }
}

export async function runDispatch(
  deps: LifecycleDispatchDeps,
  lifecycle: LifecycleRecord,
  executableWorkUnitId: string,
  revisionId: string,
): Promise<ExecuteResult> {
  const { lifecycleService, platformLifecycle } = deps;
  const attemptNumber = (await lifecycleService.countDispatchAttempts(executableWorkUnitId)) + 1;
  const { dispatchRecord } = await lifecycleService.prepareDispatch({
    lifecycleId: lifecycle.id,
    executableWorkUnitId,
    idempotencyKey: `lifecycle-dispatch:${lifecycle.id}:${revisionId}:attempt-${attemptNumber}`,
    attemptNumber,
  });

  const startedAt = Date.now();
  let executionResult: ExecuteResult;
  try {
    // CONTRACT (spec 4.2): executeApproved takes the ORIGINAL WorkUnit id and
    // dispatches from the WorkTrace, which now carries the frozen payload (4.1).
    executionResult = await platformLifecycle.executeApproved(lifecycle.actionEnvelopeId);
  } catch (err) {
    await lifecycleService.recordDispatchOutcome({
      dispatchRecordId: dispatchRecord.id,
      state: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    await markRecoveryRequired(deps, lifecycle.id);
    throw err;
  }
  await lifecycleService.recordDispatchOutcome({
    dispatchRecordId: dispatchRecord.id,
    state: executionResult.success ? "succeeded" : "failed",
    outcome: executionResult.summary,
    ...(executionResult.success ? {} : { errorMessage: executionResult.summary }),
    durationMs: Date.now() - startedAt,
  });
  if (!executionResult.success) {
    await markRecoveryRequired(deps, lifecycle.id);
  }
  return executionResult;
}

/**
 * Review #3 (parked spec): an approved action whose dispatch failed must come
 * BACK to the operator (as a Retry card), never vanish into logs.
 */
async function markRecoveryRequired(
  deps: Pick<LifecycleDispatchDeps, "lifecycleService" | "logger">,
  lifecycleId: string,
): Promise<void> {
  const fresh = await deps.lifecycleService.getLifecycleById(lifecycleId);
  if (!fresh || fresh.status !== "approved") return;
  try {
    await deps.lifecycleService.transitionStatus(fresh, "recovery_required");
  } catch (err) {
    deps.logger.error(
      { lifecycleId, err: err instanceof Error ? err.message : String(err) },
      "Failed to mark lifecycle recovery_required",
    );
  }
}
