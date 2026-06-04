import { timingSafeEqual } from "node:crypto";
import type { ExecuteResult, Principal } from "@switchboard/schemas";
import type { ApprovalStore } from "../storage/interfaces.js";
import type { ReplySink, HandleApprovalResponseConfig } from "./types.js";
import type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";
import type { RespondToApprovalResult } from "../approval/respond-to-approval.js";
import { respondToApproval } from "../approval/respond-to-approval.js";
import {
  respondToParkedLifecycle,
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
} from "../approval/respond-to-parked-lifecycle.js";
import { DispatchAdmissionError } from "../approval/dispatch-admission.js";
import { StaleVersionError } from "../approval/state-machine.js";

export const NOT_FOUND_MSG =
  "I couldn't find this approval. It may have expired, been completed, or been replaced. Open the latest approval and try again.";

export const STALE_MSG =
  "This approval link is no longer valid. It may have expired or been replaced by a newer approval. Open the latest approval and try again.";

export const NOT_AUTHORIZED_MSG =
  "This number isn't authorized to respond to approvals. Ask an admin to bind your operator account to this channel, or use the dashboard.";

export const APPROVAL_LOOKUP_ERROR_MSG =
  "I couldn't verify this approval right now. Please open the dashboard and try again.";

export const ALREADY_RESPONDED_MSG =
  "This approval was already handled. Open the dashboard to see the latest state.";

export const REJECT_SUCCESS_MSG = "Rejected.";

// Honest outcome replies (chat-approval-seam spec section 3): the reply tracks
// what actually happened, not what was requested.
export const APPROVE_EXECUTED_MSG = "Approved. The action has run or is queued to run.";

export const APPROVE_DISPATCH_FAILED_MSG =
  "Approved, but the action did not run. It is waiting in your inbox as a Retry card. Approving it there retries it.";

export const PARTIAL_APPROVAL_MSG =
  "Your approval is recorded. More approvals are required before it runs.";

export const SELF_APPROVAL_MSG =
  "You cannot approve an action you initiated. Another operator must respond.";

export const ADMISSION_FAILED_MSG =
  "Approved, but execution could not start. Open the dashboard to see its current state.";

export const APPROVAL_EXECUTION_ERROR_MSG =
  "I verified your authority but couldn't apply your response. The action remains pending. Please try the dashboard.";

/**
 * Roles that authorize a Principal to respond to approvals from a bound channel. We
 * deliberately exclude `emergency_responder` here: emergency overrides exist for incident
 * response on the API/dashboard surface and do not belong on a chat surface, where the
 * caller can't see the broader system state required to use that role responsibly. Note
 * that the API approval route enforces no role check at all (it relies on
 * `request.principalIdFromAuth === body.respondedBy`); the chat surface is intentionally
 * stricter because the caller's authority is asserted via a binding lookup, not auth.
 */
export const APPROVER_ROLES = ["approver", "operator", "admin"] as const;

function principalHasApproverRole(principal: Principal): boolean {
  return principal.roles.some((r) => (APPROVER_ROLES as readonly string[]).includes(r));
}

function timingSafeMatch(stored: string | undefined | null, supplied: string): boolean {
  if (typeof stored !== "string" || stored.length === 0) return false;
  if (stored.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(supplied, "utf8"));
}

/**
 * Channel-possession alone is NOT authority: require an active
 * OperatorChannelBinding to a Principal carrying an approver role. Fail closed
 * when the binding stack is not wired. Replies NOT_AUTHORIZED itself and
 * returns null when refusing.
 */
async function authorizeOperator(args: {
  config: HandleApprovalResponseConfig | undefined;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
  replySink: ReplySink;
}): Promise<string | null> {
  const { config } = args;
  if (!config) {
    await args.replySink.send(NOT_AUTHORIZED_MSG);
    return null;
  }
  const binding = await config.bindingStore.findActiveBinding({
    organizationId: args.organizationId,
    channel: args.channel,
    channelIdentifier: args.channelIdentifier,
  });
  if (!binding) {
    await args.replySink.send(NOT_AUTHORIZED_MSG);
    return null;
  }
  const principal = await config.identityStore.getPrincipal(binding.principalId);
  if (!principal || !principalHasApproverRole(principal)) {
    await args.replySink.send(NOT_AUTHORIZED_MSG);
    return null;
  }
  return binding.principalId;
}

/**
 * Honest outcome reply: success covers completed AND queued (the #860
 * mapping); a null execution on an approve means a quorum is still open.
 */
function replyForOutcome(
  action: "approve" | "reject",
  executionResult: ExecuteResult | null,
): string {
  if (action === "reject") return REJECT_SUCCESS_MSG;
  if (executionResult === null) return PARTIAL_APPROVAL_MSG;
  return executionResult.success ? APPROVE_EXECUTED_MSG : APPROVE_DISPATCH_FAILED_MSG;
}

function replyForError(err: unknown): string {
  if (err instanceof StaleVersionError) return ALREADY_RESPONDED_MSG;
  if (err instanceof ParkedLifecycleNotFoundError) return NOT_FOUND_MSG;
  if (err instanceof ParkedLifecycleAlreadyRespondedError) return ALREADY_RESPONDED_MSG;
  if (err instanceof ParkedLifecycleExpiredError) return STALE_MSG;
  if (err instanceof DispatchAdmissionError) {
    // Raced/expired admission between approve and execute: the action is
    // approved but did not start. "Remains pending" would be a lie here.
    return ADMISSION_FAILED_MSG;
  }
  if (err instanceof Error && /lifecycle status is "/.test(err.message)) {
    // Race: another responder mutated state between our pre-check and the
    // lifecycle call ("Cannot approve: lifecycle status is ...").
    return ALREADY_RESPONDED_MSG;
  }
  if (err instanceof Error && /stale binding/i.test(err.message)) return STALE_MSG;
  if (err instanceof Error && /self-approval/i.test(err.message)) return SELF_APPROVAL_MSG;
  return APPROVAL_EXECUTION_ERROR_MSG;
}

export async function handleApprovalResponse(params: {
  payload: ParsedApprovalResponsePayload;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
  approvalStore: ApprovalStore;
  replySink: ReplySink;
  config?: HandleApprovalResponseConfig;
}): Promise<void> {
  const { payload, organizationId, channel, channelIdentifier, approvalStore, replySink, config } =
    params;

  let approval: Awaited<ReturnType<ApprovalStore["getById"]>>;
  try {
    approval = await approvalStore.getById(payload.approvalId);
  } catch {
    await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
    return;
  }

  if (!approval) {
    // Lifecycle fallback (mirrors the #877 route fallback): parked WorkUnits
    // and post-restart in-memory rows have no ApprovalRequest row; the id on
    // the button may be a lifecycle id. Approve on recovery_required IS retry.
    await respondViaLifecycleFallback(params);
    return;
  }

  if (approval.organizationId !== organizationId) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  // Pre-check approval state. Once an approval has been responded to or expired, retrying
  // here is futile and confusing — the dashboard 409s on the same condition; chat needs a
  // distinct reply so the user knows the action already landed (vs. a downstream failure).
  if (approval.state.status !== "pending") {
    await replySink.send(ALREADY_RESPONDED_MSG);
    return;
  }

  if (!timingSafeMatch(approval.request.bindingHash, payload.bindingHash)) {
    await replySink.send(STALE_MSG);
    return;
  }

  // Hash matches — but channel-possession alone is NOT authority.
  const principalId = await authorizeOperator({
    config,
    organizationId,
    channel,
    channelIdentifier,
    replySink,
  });
  if (!principalId || !config) return;

  let result: RespondToApprovalResult;
  try {
    result = await respondToApproval(
      config.respondDeps,
      {
        approvalId: payload.approvalId,
        action: payload.action,
        respondedBy: principalId,
        bindingHash: payload.bindingHash,
      },
      approval,
    );
  } catch (err) {
    await replySink.send(replyForError(err));
    return;
  }

  await replySink.send(replyForOutcome(payload.action, result.executionResult));
}

/**
 * Lifecycle fallback leg: the approval row is missing but the id may be an
 * ApprovalLifecycle id (parked WorkUnits; future lifecycle-native chat
 * notifications; in-memory rows lost to a restart in dev). Same authority
 * model as the legacy leg: org check, hash pre-check against the CURRENT
 * revision, binding + role auth, then the lifecycle-native respond (whose
 * approve-on-recovery_required IS the retry leg).
 */
async function respondViaLifecycleFallback(params: {
  payload: ParsedApprovalResponsePayload;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
  replySink: ReplySink;
  config?: HandleApprovalResponseConfig;
}): Promise<void> {
  const { payload, organizationId, replySink, config } = params;
  const lifecycleService = config?.respondDeps.lifecycleService ?? null;
  const workTraceStore = config?.respondDeps.workTraceStore ?? null;
  if (!config || !lifecycleService || !workTraceStore) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  let lifecycle;
  try {
    lifecycle = await lifecycleService.getLifecycleById(payload.approvalId);
  } catch {
    await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
    return;
  }
  if (!lifecycle || lifecycle.organizationId !== organizationId) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  // Approve commits to the CURRENT revision; refuse a button whose hash no
  // longer matches it (e.g. after a patch) before any mutation. Reject
  // deliberately skips this pre-check: the parked contract (and the API
  // route) accept a reject without a binding hash; authority comes from the
  // binding + role, not from hash possession.
  if (payload.action === "approve") {
    let revision;
    try {
      revision = await lifecycleService.getCurrentRevision(lifecycle.id);
    } catch {
      await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
      return;
    }
    if (!timingSafeMatch(revision?.bindingHash, payload.bindingHash)) {
      await replySink.send(STALE_MSG);
      return;
    }
  }

  const principalId = await authorizeOperator({
    config,
    organizationId,
    channel: params.channel,
    channelIdentifier: params.channelIdentifier,
    replySink,
  });
  if (!principalId) return;

  try {
    const result = await respondToParkedLifecycle(
      {
        lifecycleService,
        workTraceStore,
        platformLifecycle: config.respondDeps.platformLifecycle,
        auditLedger: config.respondDeps.auditLedger,
        logger: config.respondDeps.logger,
        selfApprovalAllowed: config.respondDeps.selfApprovalAllowed,
      },
      {
        lifecycleId: lifecycle.id,
        action: payload.action,
        respondedBy: principalId,
        bindingHash: payload.bindingHash,
      },
    );
    await replySink.send(replyForOutcome(payload.action, result.executionResult));
  } catch (err) {
    await replySink.send(replyForError(err));
  }
}
