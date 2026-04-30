import { timingSafeEqual } from "node:crypto";
import type { ApprovalStore, IdentityStore } from "../storage/interfaces.js";
import type { Principal } from "@switchboard/schemas";
import type { ReplySink } from "./types.js";
import type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";
import type { OperatorChannelBindingStore } from "./operator-channel-binding-store.js";
import type {
  RespondToApprovalDeps,
  RespondToApprovalResult,
} from "../approval/respond-to-approval.js";
import { respondToApproval } from "../approval/respond-to-approval.js";

export const NOT_FOUND_MSG =
  "I couldn't find this approval. It may have expired, been completed, or been replaced. Open the latest approval and try again.";

export const STALE_MSG =
  "This approval link is no longer valid. It may have expired or been replaced by a newer approval. Open the latest approval and try again.";

export const NOT_AUTHORIZED_MSG =
  "This number isn't authorized to respond to approvals. Ask an admin to bind your operator account to this channel, or use the dashboard.";

export const APPROVAL_LOOKUP_ERROR_MSG =
  "I couldn't verify this approval right now. Please open the dashboard and try again.";

export const APPROVE_SUCCESS_MSG = "Approved.";
export const REJECT_SUCCESS_MSG = "Rejected.";

export const APPROVAL_EXECUTION_ERROR_MSG =
  "I verified your authority but couldn't apply your response. The action remains pending. Please try the dashboard.";

/** Roles that authorize a Principal to respond to approvals from a bound channel. */
export const APPROVER_ROLES = ["approver", "operator", "admin"] as const;

function principalHasApproverRole(principal: Principal): boolean {
  return principal.roles.some((r) => (APPROVER_ROLES as readonly string[]).includes(r));
}

/**
 * Configuration to enable chat approval execution. When provided, hash-match success
 * triggers an OperatorChannelBinding lookup → role check → shared respondToApproval call,
 * mutating the approval lifecycle the same way the API route does. When omitted (e.g.,
 * tests, misconfiguration), hash-match succeeds but the response is "not authorized" —
 * we MUST NOT execute on hash match alone (channel-possession ≠ authority).
 */
export interface HandleApprovalResponseConfig {
  bindingStore: OperatorChannelBindingStore;
  identityStore: IdentityStore;
  respondDeps: RespondToApprovalDeps;
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
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  if (approval.organizationId !== organizationId) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  const stored = approval.request.bindingHash;
  const supplied = payload.bindingHash;

  if (typeof stored !== "string" || stored.length === 0) {
    await replySink.send(STALE_MSG);
    return;
  }

  if (stored.length !== supplied.length) {
    await replySink.send(STALE_MSG);
    return;
  }

  const matches = timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(supplied, "utf8"));
  if (!matches) {
    await replySink.send(STALE_MSG);
    return;
  }

  // Hash matches — but channel-possession alone is NOT authority. We require an active
  // OperatorChannelBinding to a Principal carrying an approver role. If the binding stack
  // isn't wired (test or misconfigured deployment), fail closed.
  if (!config) {
    await replySink.send(NOT_AUTHORIZED_MSG);
    return;
  }

  const binding = await config.bindingStore.findActiveBinding({
    organizationId,
    channel,
    channelIdentifier,
  });
  if (!binding) {
    await replySink.send(NOT_AUTHORIZED_MSG);
    return;
  }

  const principal = await config.identityStore.getPrincipal(binding.principalId);
  if (!principal || !principalHasApproverRole(principal)) {
    await replySink.send(NOT_AUTHORIZED_MSG);
    return;
  }

  let result: RespondToApprovalResult;
  try {
    result = await respondToApproval(
      config.respondDeps,
      {
        approvalId: payload.approvalId,
        action: payload.action,
        respondedBy: binding.principalId,
        bindingHash: supplied,
      },
      approval,
    );
  } catch {
    await replySink.send(APPROVAL_EXECUTION_ERROR_MSG);
    return;
  }

  // Successful mutation — confirm to the operator. The result is intentionally not
  // surfaced in detail here; the dashboard remains the canonical view for execution
  // outcomes. Future work can enrich this reply (e.g. include booking time on approve).
  void result;
  await replySink.send(payload.action === "approve" ? APPROVE_SUCCESS_MSG : REJECT_SUCCESS_MSG);
}
