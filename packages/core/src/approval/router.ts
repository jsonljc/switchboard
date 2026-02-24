import type { ApprovalRequirement, RiskCategory } from "@switchboard/schemas";
import type { ResolvedIdentity } from "../identity/spec.js";

export interface ApprovalRouting {
  approvalRequired: ApprovalRequirement;
  approvers: string[];
  fallbackApprover: string | null;
  expiresInMs: number;
  expiredBehavior: "deny";
}

export interface ApprovalRoutingConfig {
  defaultApprovers: string[];
  defaultFallbackApprover: string | null;
  defaultExpiryMs: number;
  defaultExpiredBehavior: "deny";
  elevatedExpiryMs: number;
  mandatoryExpiryMs: number;
  /**
   * If true, approval requests with no approvers will be auto-denied
   * rather than created with an empty approver list.
   * Default: true (safe by default).
   */
  denyWhenNoApprovers: boolean;
}

export const DEFAULT_ROUTING_CONFIG: ApprovalRoutingConfig = {
  defaultApprovers: [],
  defaultFallbackApprover: null,
  defaultExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
  defaultExpiredBehavior: "deny",
  elevatedExpiryMs: 12 * 60 * 60 * 1000, // 12 hours
  mandatoryExpiryMs: 4 * 60 * 60 * 1000, // 4 hours
  denyWhenNoApprovers: true,
};

export function routeApproval(
  riskCategory: RiskCategory,
  identity: ResolvedIdentity,
  config: ApprovalRoutingConfig = DEFAULT_ROUTING_CONFIG,
): ApprovalRouting {
  const approvalRequired = identity.effectiveRiskTolerance[riskCategory];

  let expiresInMs: number;
  switch (approvalRequired) {
    case "mandatory":
      expiresInMs = config.mandatoryExpiryMs;
      break;
    case "elevated":
      expiresInMs = config.elevatedExpiryMs;
      break;
    default:
      expiresInMs = config.defaultExpiryMs;
  }

  // Resolve approvers: identity delegatedApprovers > config defaults
  let approvers = config.defaultApprovers;
  if (identity.delegatedApprovers && identity.delegatedApprovers.length > 0) {
    approvers = identity.delegatedApprovers;
  }

  // Safety: if approval is required but no approvers are configured,
  // either deny or use fallback approver
  if (
    approvalRequired !== "none" &&
    approvers.length === 0 &&
    !config.defaultFallbackApprover
  ) {
    if (config.denyWhenNoApprovers) {
      // Override to "none" is wrong — we need to signal denial.
      // Return mandatory with empty approvers; the orchestrator will
      // check and deny if no approvers are available.
      return {
        approvalRequired: "mandatory",
        approvers: [],
        fallbackApprover: null,
        expiresInMs,
        expiredBehavior: "deny",
      };
    }
  }

  return {
    approvalRequired,
    approvers,
    fallbackApprover: config.defaultFallbackApprover,
    expiresInMs,
    expiredBehavior: config.defaultExpiredBehavior,
  };
}
