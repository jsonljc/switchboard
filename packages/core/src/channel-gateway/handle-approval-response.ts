import { timingSafeEqual } from "node:crypto";
import type { ApprovalStore } from "../storage/interfaces.js";
import type { ReplySink } from "./types.js";
import type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";

export const NOT_FOUND_MSG =
  "I couldn't find this approval. It may have expired, been completed, or been replaced. Open the latest approval and try again.";

export const STALE_MSG =
  "This approval link is no longer valid. It may have expired or been replaced by a newer approval. Open the latest approval and try again.";

export const DASHBOARD_HANDOFF_MSG =
  "Approval buttons in chat are being upgraded. Please approve or reject this from the dashboard for now.";

export const APPROVAL_LOOKUP_ERROR_MSG =
  "I couldn't verify this approval right now. Please open the dashboard and try again.";

export async function handleApprovalResponse(params: {
  payload: ParsedApprovalResponsePayload;
  organizationId: string;
  approvalStore: ApprovalStore;
  replySink: ReplySink;
}): Promise<void> {
  const { payload, organizationId, approvalStore, replySink } = params;

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

  await replySink.send(DASHBOARD_HANDOFF_MSG);
}
