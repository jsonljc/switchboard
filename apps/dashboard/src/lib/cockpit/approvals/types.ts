import type { PendingApproval } from "@/lib/api-client-types";

/**
 * The wire shape from GET /api/approvals/pending. Used by the QUEUE only.
 * Do not read fields outside this shape in queue contexts.
 */
export type PendingRow = PendingApproval;

/**
 * The wire shape from GET /api/approvals/:id, plus optional extensions for
 * fields seen in fixtures or the future quorum/recovery payload (gated in
 * PR-A2b). All extensions are `?:` so live data stays valid even if the
 * backend hasn't started returning them yet.
 *
 * Used by the DETAIL pane only.
 */
export interface DetailRow extends PendingApproval {
  agent?: string;
  requestedBy?: string;
  request?: {
    action?: string;
    parametersSnapshot?: Record<string, unknown>;
    approvers?: string[];
    approvalsRequired?: number;
  };
  state?: {
    approvalHashes?: string[];
    respondedBy?: string | null;
    respondedAt?: string | null;
  };
  recovery?: { reason?: string; proposedFix?: string; lastAttemptAt?: string };
  patchProposal?: { proposedBy?: string; proposedAt?: string; diff?: Record<string, unknown> };
}

/**
 * Narrow base shape. Both `PendingRow` and `DetailRow` satisfy it, so this is
 * suitable for code paths that need only the wire-level fields shared by both
 * (e.g. sort, queue-row rendering). Prefer the specific type at the consumer.
 */
export type ApprovalRow = PendingRow;

export type RiskCategory = PendingApproval["riskCategory"];
export type LifecycleStatus = PendingApproval["status"];
