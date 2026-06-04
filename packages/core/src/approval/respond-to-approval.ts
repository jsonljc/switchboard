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
//
// The lifecycle fork lives in respond-via-lifecycle.ts and ends in the shared
// dispatch engine (lifecycle-dispatch.ts): an approve either executes the
// frozen payload or transitions the lifecycle to "recovery_required". No
// approve leg ends in bare approveLifecycle.

import type { ApprovalRequest, ExecuteResult } from "@switchboard/schemas";
import type { ApprovalState } from "../approval/state-machine.js";
import type { ApprovalLifecycleService } from "../approval/lifecycle-service.js";
import type { WorkTraceStore } from "../platform/work-trace-recorder.js";
import type { ApprovalStore, EnvelopeStore } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";
import type { ExecuteApprovedLike } from "./lifecycle-dispatch.js";
import { respondViaLifecycle, getWorkTrace } from "./respond-via-lifecycle.js";

export interface PlatformLifecycleLike extends ExecuteApprovedLike {
  respondToApproval(params: {
    approvalId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash: string;
    patchValue?: Record<string, unknown>;
  }): Promise<{
    envelope: unknown;
    approvalState: unknown;
    executionResult: ExecuteResult | null;
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
  /** Legacy fallback for approvals without a lifecycle record; also the dispatch engine. */
  platformLifecycle: PlatformLifecycleLike;
  /** Optional session-resume hook. Best-effort: failures surface as resumeWarning. */
  sessionManager: SessionManagerLike | null;
  /** Optional audit ledger: the lifecycle fork records action.approved/patched. */
  auditLedger?: AuditLedger;
  logger: RespondToApprovalLogger;
  /**
   * When false/undefined (the default, and the production default — wired from
   * ALLOW_SELF_APPROVAL), an action's own originator may not approve or patch
   * it on the lifecycle path. Mirrors PlatformLifecycle's selfApprovalAllowed
   * so both response paths share the same four-eyes posture.
   */
  selfApprovalAllowed?: boolean;
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
  executionResult: ExecuteResult | null;
  resumeWarning?: string;
}

/**
 * Execute an approval response. Caller is responsible for surface-specific authentication
 * (API: `authenticatedPrincipal === respondedBy`; chat: `OperatorChannelBinding` lookup +
 * role check). Self-approval prevention on the lifecycle path is enforced here so both
 * surfaces share it (the legacy path enforces it inside PlatformLifecycle).
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
    executionResult: ExecuteResult | null;
  };

  if (lifecycle && deps.lifecycleService) {
    // Four-eyes guard (A2): the action's own originator may not approve/patch it
    // on the lifecycle path unless selfApprovalAllowed. Runs BEFORE
    // respondViaLifecycle so a rejected self-approval mutates no state.
    await assertNotSelfApproval(deps, params, approval);

    response = await respondViaLifecycle({
      deps: {
        lifecycleService: deps.lifecycleService,
        approvalStore: deps.approvalStore,
        envelopeStore: deps.envelopeStore,
        workTraceStore: deps.workTraceStore,
        platformLifecycle: deps.platformLifecycle,
        auditLedger: deps.auditLedger,
        logger: deps.logger,
      },
      lifecycle,
      approval,
      params,
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

/**
 * Four-eyes / human-override guard (DOCTRINE §8). Prevent an action's own
 * originator from approving or patching it on the lifecycle path. The legacy
 * PlatformLifecycle path enforces the same via preventSelfApprovalFromTrace;
 * this is its lifecycle-path counterpart, so both surfaces share the posture.
 * Default is prevent; `selfApprovalAllowed` (wired from ALLOW_SELF_APPROVAL) is
 * the escape hatch. Reject/expire are exempt — only approve/patch advance the
 * action toward execution. The originator is read from the canonical WorkTrace
 * (actor.id); when it can't be determined (no trace) the guard does not fire,
 * matching the legacy behavior.
 */
async function assertNotSelfApproval(
  deps: RespondToApprovalDeps,
  params: RespondToApprovalParams,
  approval: ApprovalRecordForResponse,
): Promise<void> {
  if (deps.selfApprovalAllowed) return;
  if (params.action !== "approve" && params.action !== "patch") return;
  const trace = await getWorkTrace(deps.workTraceStore, approval.envelopeId);
  const originator = trace?.actor?.id;
  if (originator && originator === params.respondedBy) {
    throw new Error("Self-approval is not permitted");
  }
}
