import type { ReplySink, HandleApprovalResponseConfig } from "./types.js";
import type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";
import type { ApprovalStore } from "../storage/interfaces.js";
import type { ChannelApprovalRespondOutcome } from "./respond-to-channel-approval.js";
import { respondToChannelApproval } from "./respond-to-channel-approval.js";

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

// Identity derivation (APPROVER_ROLES + binding + role check) lives with the
// flow in respond-to-channel-approval.ts; re-exported here for compatibility.
export { APPROVER_ROLES } from "./respond-to-channel-approval.js";

/**
 * Honest outcome reply: the reply tracks what actually happened, not what was
 * requested (chat-approval-seam spec section 3; bridge spec table 3.3).
 * Success covers completed AND queued (the #860 mapping); a null execution on
 * an approve means a quorum is still open.
 */
export function replyForChannelOutcome(outcome: ChannelApprovalRespondOutcome): string {
  if (outcome.kind === "responded") {
    if (outcome.action === "reject") return REJECT_SUCCESS_MSG;
    if (outcome.executionSuccess === null) return PARTIAL_APPROVAL_MSG;
    return outcome.executionSuccess ? APPROVE_EXECUTED_MSG : APPROVE_DISPATCH_FAILED_MSG;
  }
  switch (outcome.code) {
    case "not_found":
      return NOT_FOUND_MSG;
    case "stale":
    case "expired":
      return STALE_MSG;
    case "not_authorized":
      return NOT_AUTHORIZED_MSG;
    case "lookup_error":
      return APPROVAL_LOOKUP_ERROR_MSG;
    case "already_responded":
    case "conflict":
      return ALREADY_RESPONDED_MSG;
    case "self_approval":
      return SELF_APPROVAL_MSG;
    case "admission_failed":
      return ADMISSION_FAILED_MSG;
    case "execution_error":
      return APPROVAL_EXECUTION_ERROR_MSG;
  }
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

  const request = {
    approvalId: payload.approvalId,
    action: payload.action,
    bindingHash: payload.bindingHash,
    organizationId,
    channel,
    channelIdentifier,
  };

  if (config && "transport" in config) {
    // Bridged topology: thin-forward the webhook-authenticated identity. The
    // API re-derives the principal and runs the engine; no local lookups here
    // (one authority, not two). A transport failure renders as a lookup
    // error: honest (nothing verified, the dashboard works) and re-tap safe
    // (a duplicate respond surfaces as already_responded).
    let outcome: ChannelApprovalRespondOutcome;
    try {
      outcome = await config.transport.respond(request);
    } catch {
      await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
      return;
    }
    await replySink.send(replyForChannelOutcome(outcome));
    return;
  }

  const outcome = await respondToChannelApproval(
    {
      approvalStore,
      bindingStore: config?.bindingStore ?? null,
      identityStore: config?.identityStore ?? null,
      respondDeps: config?.respondDeps ?? null,
    },
    request,
  );
  await replySink.send(replyForChannelOutcome(outcome));
}
