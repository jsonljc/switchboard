// ---------------------------------------------------------------------------
// Lifecycle-backed respond fork (legacy ApprovalRequest row + ApprovalLifecycle
// row for the same work unit)
// ---------------------------------------------------------------------------
//
// Extracted from respond-to-approval.ts and rebuilt in LIFECYCLE-AUTHORITY
// order (chat-approval-seam spec 2.2/2.3): approveLifecycle is the authority
// commit; every later step fails TOWARD dispatch-or-recovery, never away from
// it. The legacy ApprovalRequest row is a side record on this path: its sync
// happens after the authority commit and is best-effort (logged skew, never an
// abort). Approve and patch both end in the shared dispatch engine
// (lifecycle-dispatch.ts); patch keeps the legacy surface contract
// (patch responds AND executes) with revision-grade payload authority.

import type { ExecuteResult } from "@switchboard/schemas";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";
import type { LifecycleRecord } from "./lifecycle-types.js";
import type { WorkTrace } from "../platform/work-trace.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { DeploymentContext } from "../platform/deployment-context.js";
import type { WorkUnit } from "../platform/work-unit.js";
import type { ApprovalStore, EnvelopeStore } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";
import { transitionApproval } from "./state-machine.js";
import { computeBindingHash, hashObject } from "./binding.js";
import {
  runDispatch,
  writeApprovedPayloadToTrace,
  type ExecuteApprovedLike,
} from "./lifecycle-dispatch.js";
import type {
  ApprovalRecordForResponse,
  RespondToApprovalLogger,
  RespondToApprovalParams,
} from "./respond-to-approval.js";

export interface RespondViaLifecycleDeps {
  lifecycleService: ApprovalLifecycleService;
  approvalStore: ApprovalStore;
  envelopeStore: EnvelopeStore;
  workTraceStore: WorkTraceStore | null;
  platformLifecycle: ExecuteApprovedLike;
  auditLedger?: AuditLedger;
  logger: RespondToApprovalLogger;
}

export async function respondViaLifecycle(args: {
  deps: RespondViaLifecycleDeps;
  lifecycle: LifecycleRecord;
  approval: ApprovalRecordForResponse;
  params: RespondToApprovalParams;
}): Promise<{ envelope: unknown; approvalState: unknown; executionResult: ExecuteResult | null }> {
  const { deps, lifecycle, approval, params } = args;

  if (params.action === "reject") {
    return rejectViaLifecycle(deps, lifecycle, approval, params);
  }

  // PURE compute: throws on a non-pending legacy row (already-responded guard).
  // Persisted only AFTER the lifecycle authority commit (or immediately for a
  // quorum partial, which never touches the lifecycle).
  const newState = transitionApproval(
    approval.state,
    params.action,
    params.respondedBy,
    params.patchValue,
  );

  // Quorum short-circuit: a partial approval is recorded on the legacy row
  // only. The lifecycle stays pending; nothing materializes, nothing runs.
  if (params.action === "approve" && newState.status !== "approved") {
    await deps.approvalStore.updateState(
      approval.request.id,
      newState,
      approval.state.version,
      approval.organizationId ?? null,
    );
    deps.logger.info(
      { lifecycleId: lifecycle.id, approvalId: approval.request.id },
      "Partial quorum approval recorded; lifecycle untouched",
    );
    return { envelope: null, approvalState: newState, executionResult: null };
  }

  const trace = await getWorkTrace(deps.workTraceStore, approval.envelopeId);
  const workUnit = reconstructWorkUnit(trace, approval);
  const respondedAt = new Date().toISOString();

  // Patch first parks the patched payload as a NEW revision; the approve
  // commits to it. createRevision validates sourceBindingHash against the
  // current revision, so a stale patch dies before any mutation beyond the
  // revision row itself.
  let clientBindingHash = params.bindingHash;
  let patchedBindingHash: string | null = null;
  if (params.action === "patch") {
    if (!params.patchValue) {
      throw new Error("patchValue is required for patch action");
    }
    const patchedParams = { ...(trace?.parameters ?? {}), ...params.patchValue };
    const newBindingHash = computeBindingHash({
      envelopeId: approval.envelopeId,
      envelopeVersion: (approval.state.version ?? 0) + 1,
      actionId: approval.request.actionId,
      parameters: patchedParams,
      decisionTraceHash: hashObject({ governance: "patched" }),
      contextSnapshotHash: hashObject({ actor: params.respondedBy }),
    });
    const revision = await deps.lifecycleService.createRevision({
      lifecycleId: lifecycle.id,
      parametersSnapshot: patchedParams,
      approvalScopeSnapshot: {},
      bindingHash: newBindingHash,
      createdBy: params.respondedBy,
      sourceBindingHash: params.bindingHash,
      rationale: "Patched via approval respond",
    });
    clientBindingHash = revision.bindingHash;
    patchedBindingHash = revision.bindingHash;
    workUnit.parameters = patchedParams;
  }

  // THE authority commit: optimistic-locked, binding-hash-checked against the
  // CURRENT revision. Failure here mutates nothing else.
  const { lifecycle: approvedLifecycle, executableWorkUnit } =
    await deps.lifecycleService.approveLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: params.respondedBy,
      clientBindingHash,
      workUnit,
      actionEnvelopeId: approval.envelopeId,
      constraints: (trace?.governanceConstraints as unknown as Record<string, unknown>) ?? {},
    });

  // Payload authority (parked spec 4.1): the trace carries the frozen payload
  // before dispatch. Tolerates a missing trace store (legacy units dispatch
  // from the envelope payload) but never a rejected write.
  if (deps.workTraceStore) {
    await writeApprovedPayloadToTrace({
      deps: { workTraceStore: deps.workTraceStore },
      lifecycle: approvedLifecycle,
      executableWorkUnit,
      fallbackParameters: workUnit.parameters,
      approvalOutcome: params.action === "patch" ? "patched" : "approved",
      respondedBy: params.respondedBy,
      respondedAt,
      caller: "respond_via_lifecycle",
    });
  } else {
    deps.logger.error(
      { lifecycleId: lifecycle.id },
      "WorkTraceStore unavailable; dispatching from the envelope payload",
    );
  }

  // executeAfterApproval refuses to dispatch unless the envelope (when one
  // exists) is approved; flip it before dispatch.
  const envelope = await deps.envelopeStore.getById(approval.envelopeId);
  if (envelope) {
    await deps.envelopeStore.update(
      envelope.id,
      { status: "approved" },
      approval.organizationId ?? null,
    );
  }

  // Legacy row = side record: best-effort sync AFTER the authority commit.
  // Once the lifecycle is approved, nothing may stand between it and
  // dispatch-or-recovery; aborting here would recreate the bare-approve hole.
  try {
    await deps.approvalStore.updateState(
      approval.request.id,
      newState,
      approval.state.version,
      approval.organizationId ?? null,
    );
  } catch (err) {
    deps.logger.error(
      { err, approvalId: approval.request.id, lifecycleId: lifecycle.id },
      "Legacy approval-row sync failed after lifecycle approve; continuing to dispatch",
    );
  }

  const executionResult = await runDispatch(
    {
      lifecycleService: deps.lifecycleService,
      workTraceStore: deps.workTraceStore as WorkTraceStore,
      platformLifecycle: deps.platformLifecycle,
      logger: deps.logger,
    },
    approvedLifecycle,
    executableWorkUnit.id,
    executableWorkUnit.approvalRevisionId,
  );

  await recordLedger(deps.auditLedger, params, lifecycle, trace);
  deps.logger.info(
    {
      lifecycleId: lifecycle.id,
      workUnitId: approval.envelopeId,
      success: executionResult.success,
    },
    "Lifecycle-backed approval dispatched",
  );

  const updatedEnvelope = envelope
    ? ((await deps.envelopeStore.getById(envelope.id)) ?? envelope)
    : null;
  return {
    envelope: updatedEnvelope,
    approvalState: patchedBindingHash ? { ...newState, bindingHash: patchedBindingHash } : newState,
    executionResult,
  };
}

async function rejectViaLifecycle(
  deps: RespondViaLifecycleDeps,
  lifecycle: LifecycleRecord,
  approval: ApprovalRecordForResponse,
  params: RespondToApprovalParams,
): Promise<{ envelope: unknown; approvalState: unknown; executionResult: null }> {
  // Reject keeps the legacy-first order: no dispatch is at stake, and a raced
  // reject dying on the legacy row's optimistic lock leaves the lifecycle
  // pending (safe, retryable).
  const newState = transitionApproval(approval.state, "reject", params.respondedBy);
  await deps.approvalStore.updateState(
    approval.request.id,
    newState,
    approval.state.version,
    approval.organizationId ?? null,
  );

  if (!deps.workTraceStore) {
    throw new Error("WorkTraceStore not available for lifecycle rejection");
  }
  await deps.lifecycleService.rejectLifecycle({
    lifecycleId: lifecycle.id,
    respondedBy: params.respondedBy,
    traceStore: deps.workTraceStore,
    auditLedger: deps.auditLedger,
  });

  const envelope = await deps.envelopeStore.getById(approval.envelopeId);
  if (envelope) {
    await deps.envelopeStore.update(
      envelope.id,
      { status: "denied" },
      approval.organizationId ?? null,
    );
  }

  return { envelope: envelope ?? null, approvalState: newState, executionResult: null };
}

async function recordLedger(
  ledger: AuditLedger | undefined,
  params: RespondToApprovalParams,
  lifecycle: LifecycleRecord,
  trace: WorkTrace | null,
): Promise<void> {
  if (!ledger) return;
  const eventType = params.action === "patch" ? "action.patched" : "action.approved";
  await ledger.record({
    eventType,
    actorType: "user",
    actorId: params.respondedBy,
    entityType: "action",
    entityId: lifecycle.actionEnvelopeId,
    riskCategory: "medium",
    summary: `${params.action === "patch" ? "Action patched and approved" : "Action approved"} by ${params.respondedBy} (lifecycle-backed)`,
    snapshot: {
      lifecycleId: lifecycle.id,
      intent: trace?.intent ?? "unknown",
      ...(params.action === "patch" ? { patchValue: params.patchValue } : {}),
    },
    envelopeId: lifecycle.actionEnvelopeId,
    organizationId: lifecycle.organizationId ?? undefined,
    traceId: trace?.traceId,
  });
}

export async function getWorkTrace(
  workTraceStore: WorkTraceStore | null,
  workUnitId: string,
): Promise<WorkTrace | null> {
  if (!workTraceStore) return null;
  const result = await workTraceStore.getByWorkUnitId(workUnitId);
  return result?.trace ?? null;
}

function reconstructWorkUnit(
  trace: WorkTrace | null,
  approval: ApprovalRecordForResponse,
): WorkUnit {
  const fallbackDeployment: DeploymentContext = {
    deploymentId: "",
    skillSlug: "",
    trustLevel: "supervised",
    trustScore: 0,
  };

  if (!trace) {
    return {
      id: approval.envelopeId,
      requestedAt: approval.request.createdAt.toISOString(),
      organizationId: approval.organizationId ?? "",
      actor: { id: "system", type: "system" },
      intent: approval.request.actionId,
      parameters: {},
      deployment: fallbackDeployment,
      resolvedMode: "cartridge",
      traceId: approval.envelopeId,
      trigger: "api",
      priority: "normal",
    };
  }

  return {
    id: trace.workUnitId,
    requestedAt: trace.requestedAt,
    organizationId: trace.organizationId,
    actor: trace.actor,
    intent: trace.intent,
    parameters: trace.parameters ?? {},
    deployment: trace.deploymentContext ?? fallbackDeployment,
    resolvedMode: trace.mode,
    idempotencyKey: trace.idempotencyKey,
    parentWorkUnitId: trace.parentWorkUnitId,
    traceId: trace.traceId,
    trigger: trace.trigger,
    priority: "normal",
  };
}
