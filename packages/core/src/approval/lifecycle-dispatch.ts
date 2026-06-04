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

export interface ExecuteApprovedLike {
  executeApproved(workUnitId: string): Promise<ExecuteResult>;
}

export interface LifecycleDispatchDeps {
  lifecycleService: ApprovalLifecycleService;
  workTraceStore: WorkTraceStore;
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
  deps: Pick<LifecycleDispatchDeps, "workTraceStore">;
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
export async function markRecoveryRequired(
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
