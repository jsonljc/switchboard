// ---------------------------------------------------------------------------
// Shared approval response execution
// ---------------------------------------------------------------------------
//
// Surface-agnostic helper that mutates approval lifecycle state for both API and chat.
// Encapsulates the lifecycle-vs-legacy fork, work-trace lookup, and best-effort session
// resume so each surface (apps/api/src/routes/approvals.ts, packages/core/src/channel-gateway)
// shares one execution path. Surface-specific work — fetching the approval, checking
// authenticatedPrincipal/binding, validating bindingHash format — stays at the call site.
//
// This is the single point where `respondedBy` enters the lifecycle. Both surfaces MUST
// call through here; no direct calls to `platformLifecycle.respondToApproval` or
// `lifecycleService.approveLifecycle` from route/gateway code.

import type { ApprovalRequest } from "@switchboard/schemas";
import type { ApprovalState } from "../approval/state-machine.js";
import type { ApprovalLifecycleService } from "../approval/lifecycle-service.js";
import type { LifecycleRecord } from "../approval/lifecycle-types.js";
import type { WorkUnit } from "../platform/work-unit.js";
import type { WorkTrace } from "../platform/work-trace.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { DeploymentContext } from "../platform/deployment-context.js";
import type { ApprovalStore, EnvelopeStore } from "../storage/interfaces.js";
import { transitionApproval } from "../approval/state-machine.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";

export interface PlatformLifecycleLike {
  respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
  }): Promise<{
    envelope: unknown;
    approvalState: unknown;
    executionResult: unknown;
  }>;
}

export interface SessionManagerLike {
  resumeAfterApproval(
    approvalId: string,
    response: {
      approvalId: string;
      action: "approve" | "reject" | "patch";
      patchValue?: Record<string, unknown>;
      respondedBy: string;
      resolvedAt: string;
    },
  ): Promise<{ session: { id: string }; run: { id: string } } | null>;
}

export interface RespondToApprovalLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface RespondToApprovalDeps {
  approvalStore: ApprovalStore;
  envelopeStore: EnvelopeStore;
  /** Required for the lifecycle path; legacy path tolerates null. */
  workTraceStore: WorkTraceStore | null;
  /** Lifecycle-backed approvals route through this. Null when no lifecycle exists. */
  lifecycleService: ApprovalLifecycleService | null;
  /** Legacy fallback for approvals without a lifecycle record. */
  platformLifecycle: PlatformLifecycleLike;
  /** Optional session-resume hook. Best-effort: failures surface as resumeWarning. */
  sessionManager: SessionManagerLike | null;
  logger: RespondToApprovalLogger;
}

export interface RespondToApprovalParams {
  approvalId: string;
  action: "approve" | "reject" | "patch";
  respondedBy: string;
  bindingHash: string;
  patchValue?: Record<string, unknown>;
}

export interface ApprovalRecordForResponse {
  request: ApprovalRequest;
  state: ApprovalState;
  envelopeId: string;
  organizationId?: string | null;
}

export interface RespondToApprovalResult {
  envelope: unknown;
  approvalState: unknown;
  executionResult: unknown;
  resumeWarning?: string;
}

/**
 * Execute an approval response. Caller is responsible for surface-specific authorization
 * (API: `authenticatedPrincipal === respondedBy`; chat: `OperatorChannelBinding` lookup +
 * role check). This function performs the deterministic mutation only.
 */
export async function respondToApproval(
  deps: RespondToApprovalDeps,
  params: RespondToApprovalParams,
  approval: ApprovalRecordForResponse,
): Promise<RespondToApprovalResult> {
  const lifecycle = deps.lifecycleService
    ? await deps.lifecycleService.findByEnvelopeId(approval.envelopeId)
    : null;

  let response: {
    envelope: unknown;
    approvalState: unknown;
    executionResult: unknown;
  };

  if (lifecycle && deps.lifecycleService) {
    response = await respondViaLifecycle({
      lifecycleService: deps.lifecycleService,
      lifecycle,
      approval,
      params,
      workTraceStore: deps.workTraceStore,
      approvalStore: deps.approvalStore,
      envelopeStore: deps.envelopeStore,
      logger: deps.logger,
    });
  } else {
    const legacyResponse = await deps.platformLifecycle.respondToApproval({
      approvalId: params.approvalId,
      action: params.action,
      respondedBy: params.respondedBy,
      bindingHash: params.bindingHash,
      patchValue: params.patchValue,
    });
    response = {
      envelope: legacyResponse.envelope,
      approvalState: legacyResponse.approvalState,
      executionResult: legacyResponse.executionResult,
    };
  }

  // Best-effort session resume (only on approve)
  let resumeWarning: string | undefined;
  if (deps.sessionManager && params.action === "approve") {
    try {
      const result = await deps.sessionManager.resumeAfterApproval(params.approvalId, {
        approvalId: params.approvalId,
        action: params.action,
        patchValue: params.patchValue,
        respondedBy: params.respondedBy,
        resolvedAt: new Date().toISOString(),
      });
      if (result) {
        deps.logger.info(
          { sessionId: result.session.id, runId: result.run.id },
          "Session resumed after approval (workflow dispatch pending Phase 3)",
        );
      }
    } catch (err) {
      deps.logger.error({ err, approvalId: params.approvalId }, "Failed to enqueue session resume");
      resumeWarning = err instanceof Error ? err.message : "Failed to enqueue session resume";
    }
  }

  return {
    envelope: response.envelope,
    approvalState: response.approvalState,
    executionResult: response.executionResult,
    ...(resumeWarning ? { resumeWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle-backed path (extracted from apps/api/src/routes/approvals.ts)
// ---------------------------------------------------------------------------

async function respondViaLifecycle(args: {
  lifecycleService: ApprovalLifecycleService;
  lifecycle: LifecycleRecord;
  approval: ApprovalRecordForResponse;
  params: RespondToApprovalParams;
  workTraceStore: WorkTraceStore | null;
  approvalStore: ApprovalStore;
  envelopeStore: EnvelopeStore;
  logger: RespondToApprovalLogger;
}): Promise<{ envelope: unknown; approvalState: unknown; executionResult: unknown }> {
  const {
    lifecycleService,
    lifecycle,
    approval,
    params,
    workTraceStore,
    approvalStore,
    envelopeStore,
    logger,
  } = args;

  const newState = transitionApproval(
    approval.state,
    params.action,
    params.respondedBy,
    params.patchValue,
  );
  await approvalStore.updateState(approval.request.id, newState, approval.state.version);

  if (params.action === "reject") {
    if (!workTraceStore) {
      throw new Error("WorkTraceStore not available for lifecycle rejection");
    }
    await lifecycleService.rejectLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: params.respondedBy,
      traceStore: workTraceStore,
    });

    const envelope = await envelopeStore.getById(approval.envelopeId);
    if (envelope) {
      await envelopeStore.update(envelope.id, { status: "denied" });
    }

    return {
      envelope: envelope ?? null,
      approvalState: newState,
      executionResult: null,
    };
  }

  if (params.action === "patch") {
    if (!params.patchValue) {
      throw new Error("patchValue is required for patch action");
    }

    const trace = await getWorkTrace(workTraceStore, approval.envelopeId);
    const patchedParams = { ...(trace?.parameters ?? {}), ...params.patchValue };

    const newBindingHash = computeBindingHash({
      envelopeId: approval.envelopeId,
      envelopeVersion: (approval.state.version ?? 0) + 1,
      actionId: approval.request.actionId,
      parameters: patchedParams,
      decisionTraceHash: hashObject({ governance: "patched" }),
      contextSnapshotHash: hashObject({ actor: params.respondedBy }),
    });

    const revision = await lifecycleService.createRevision({
      lifecycleId: lifecycle.id,
      parametersSnapshot: patchedParams,
      approvalScopeSnapshot: {},
      bindingHash: newBindingHash,
      createdBy: params.respondedBy,
      sourceBindingHash: params.bindingHash,
      rationale: "Patched via approval respond",
    });

    return {
      envelope: null,
      approvalState: { ...newState, bindingHash: revision.bindingHash },
      executionResult: null,
    };
  }

  // --- approve ---
  const trace = await getWorkTrace(workTraceStore, approval.envelopeId);
  const workUnit = reconstructWorkUnit(trace, approval);

  const { lifecycle: updatedLifecycle, executableWorkUnit } =
    await lifecycleService.approveLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: params.respondedBy,
      clientBindingHash: params.bindingHash,
      workUnit,
      actionEnvelopeId: approval.envelopeId,
      constraints: (trace?.governanceConstraints as unknown as Record<string, unknown>) ?? {},
    });

  const envelope = await envelopeStore.getById(approval.envelopeId);
  if (envelope) {
    await envelopeStore.update(envelope.id, { status: "approved" });
  }

  logger.info(
    { lifecycleId: updatedLifecycle.id, executableWorkUnitId: executableWorkUnit.id },
    "Approval responded via lifecycle service",
  );

  return {
    envelope: envelope ?? null,
    approvalState: newState,
    executionResult: { executableWorkUnitId: executableWorkUnit.id },
  };
}

async function getWorkTrace(
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
