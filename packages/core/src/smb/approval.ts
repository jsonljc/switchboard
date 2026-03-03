import { createHash, randomUUID } from "node:crypto";
import type { ActionProposal, ApprovalRequest, DecisionTrace } from "@switchboard/schemas";
import type { SmbOrgConfig } from "@switchboard/schemas";
import { canonicalizeSync } from "../audit/canonical-json.js";
import { computeBindingHash, hashObject } from "../approval/binding.js";

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
 * @deprecated Use computeFullSmbBindingHash for tamper-evident parameter binding.
 */
export function smbBindingHash(envelopeId: string): string {
  return createHash("sha256").update(canonicalizeSync({ envelopeId })).digest("hex");
}

/**
 * Compute a full tamper-evident binding hash for SMB that covers parameters,
 * decision trace, and context snapshot — not just the envelope ID.
 */
export function computeFullSmbBindingHash(params: {
  envelopeId: string;
  actionId: string;
  proposal: ActionProposal;
  decisionTrace: DecisionTrace;
  contextSnapshot: Record<string, unknown>;
}): string {
  return computeBindingHash({
    envelopeId: params.envelopeId,
    envelopeVersion: 1,
    actionId: params.actionId,
    parameters: params.proposal.parameters,
    decisionTraceHash: hashObject(params.decisionTrace),
    contextSnapshotHash: hashObject(params.contextSnapshot),
  });
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
  proposal: ActionProposal;
}): ApprovalRequest {
  const now = new Date();
  const bindingHash = computeFullSmbBindingHash({
    envelopeId: params.envelopeId,
    actionId: params.actionId,
    proposal: params.proposal,
    decisionTrace: params.decisionTrace,
    contextSnapshot: params.contextSnapshot,
  });

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
