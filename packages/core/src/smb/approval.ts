import { createHash, randomUUID } from "node:crypto";
import type { ApprovalRequest, DecisionTrace } from "@switchboard/schemas";
import type { SmbOrgConfig } from "@switchboard/schemas";
import { canonicalizeSync } from "../audit/canonical-json.js";

/** 24 hours in milliseconds */
const SMB_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface SmbApprovalRouting {
  approvalRequired: boolean;
  approverId: string;
  expiresInMs: number;
}

/**
 * Route approval for an SMB org.
 * Single approver (org owner), yes/no, 24h expiry.
 */
export function smbRouteApproval(
  orgConfig: SmbOrgConfig,
  approvalNeeded: boolean,
): SmbApprovalRouting {
  return {
    approvalRequired: approvalNeeded,
    approverId: orgConfig.ownerId,
    expiresInMs: SMB_APPROVAL_EXPIRY_MS,
  };
}

/**
 * Compute a simplified binding hash for SMB (just envelope ID hash, not full tamper-evident binding).
 */
export function smbBindingHash(envelopeId: string): string {
  return createHash("sha256").update(canonicalizeSync({ envelopeId })).digest("hex");
}

/**
 * Create an ApprovalRequest for an SMB org.
 * Uses the standard ApprovalRequest type so existing ApprovalStore, API routes,
 * and dashboard work unchanged.
 */
export function smbCreateApprovalRequest(params: {
  envelopeId: string;
  actionId: string;
  summary: string;
  riskCategory: string;
  decisionTrace: DecisionTrace;
  orgConfig: SmbOrgConfig;
  contextSnapshot: Record<string, unknown>;
}): ApprovalRequest {
  const now = new Date();
  const bindingHash = smbBindingHash(params.envelopeId);

  return {
    id: `appr_${randomUUID()}`,
    actionId: params.actionId,
    envelopeId: params.envelopeId,
    conversationId: null,
    summary: params.summary,
    riskCategory: params.riskCategory,
    bindingHash,
    evidenceBundle: {
      decisionTrace: params.decisionTrace,
      contextSnapshot: params.contextSnapshot,
      identitySnapshot: { ownerId: params.orgConfig.ownerId, tier: "smb" },
    },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: [params.orgConfig.ownerId],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: new Date(now.getTime() + SMB_APPROVAL_EXPIRY_MS),
    expiredBehavior: "deny",
    createdAt: now,
    quorum: null,
  };
}
