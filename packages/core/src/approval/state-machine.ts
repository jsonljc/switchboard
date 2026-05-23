import type {
  ApprovalRequirement,
  RiskCategory,
  ApprovalState,
  ApprovalStatus,
  QuorumState,
  QuorumEntry,
} from "@switchboard/schemas";
import type { ResolvedIdentity } from "../identity/spec.js";

export type { ApprovalState, ApprovalStatus, QuorumState, QuorumEntry };

export class StaleVersionError extends Error {
  constructor(id: string, expected: number, actual: number) {
    super(`Stale version for approval ${id}: expected ${expected}, got ${actual}`);
    this.name = "StaleVersionError";
  }
}

// Cross-tenant isolation tripwire. Thrown by stores that can definitively
// distinguish tenant mismatch from version drift (e.g. InMemoryApprovalStore).
// Extends StaleVersionError so existing route catches preserve their 409
// response while observability can detect cross-tenant attempts via instanceof.
// Prisma stores cannot differentiate without an extra read, so they throw
// the parent StaleVersionError on count===0.
export class TenantMismatchError extends StaleVersionError {
  constructor(id: string, callerOrgId: string | null, storedOrgId: string | null) {
    super(id, -1, -1);
    this.message = `Tenant mismatch on ${id}: caller org=${callerOrgId} stored org=${storedOrgId}`;
    this.name = "TenantMismatchError";
  }
}

export function determineApprovalRequirement(
  riskCategory: RiskCategory,
  identity: ResolvedIdentity,
): ApprovalRequirement {
  return identity.effectiveRiskTolerance[riskCategory];
}

export function createApprovalState(
  expiresAt: Date,
  quorum?: { required: number } | null,
): ApprovalState {
  return {
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
    quorum: quorum ? { required: quorum.required, approvalHashes: [] } : null,
    version: 1,
  };
}

export function transitionApproval(
  state: ApprovalState,
  action: "approve" | "reject" | "patch" | "expire",
  respondedBy?: string,
  patchValue?: Record<string, unknown>,
  approvalHash?: string,
): ApprovalState {
  switch (action) {
    case "approve":
      if (state.status !== "pending") {
        throw new Error(`Cannot approve: current status is ${state.status}`);
      }

      // Quorum mode: accumulate approvals until threshold is met
      if (state.quorum) {
        if (!respondedBy) {
          throw new Error("Quorum approval requires respondedBy");
        }

        // Reject duplicate approvers
        if (state.quorum.approvalHashes.some((h) => h.approverId === respondedBy)) {
          throw new Error(`Approver ${respondedBy} has already approved this request`);
        }

        const newEntry: QuorumEntry = {
          approverId: respondedBy,
          hash: approvalHash ?? "",
          approvedAt: new Date(),
        };
        const newHashes = [...state.quorum.approvalHashes, newEntry];
        const newQuorum: QuorumState = { ...state.quorum, approvalHashes: newHashes };

        // Threshold met: transition to approved
        if (newHashes.length >= state.quorum.required) {
          return {
            ...state,
            status: "approved",
            respondedBy,
            respondedAt: new Date(),
            quorum: newQuorum,
            version: state.version + 1,
          };
        }

        // Still pending — more approvals needed
        return {
          ...state,
          quorum: newQuorum,
          version: state.version + 1,
        };
      }

      // Single-approver mode (unchanged behavior)
      return {
        ...state,
        status: "approved",
        respondedBy: respondedBy ?? null,
        respondedAt: new Date(),
        version: state.version + 1,
      };

    case "reject":
      if (state.status !== "pending") {
        throw new Error(`Cannot reject: current status is ${state.status}`);
      }
      return {
        ...state,
        status: "rejected",
        respondedBy: respondedBy ?? null,
        respondedAt: new Date(),
        version: state.version + 1,
      };

    case "patch":
      if (state.status !== "pending") {
        throw new Error(`Cannot patch: current status is ${state.status}`);
      }
      return {
        ...state,
        status: "patched",
        respondedBy: respondedBy ?? null,
        respondedAt: new Date(),
        patchValue: patchValue ?? null,
        version: state.version + 1,
      };

    case "expire":
      if (state.status !== "pending") {
        throw new Error(`Cannot expire: current status is ${state.status}`);
      }
      return {
        ...state,
        status: "expired",
        respondedBy: null,
        respondedAt: new Date(),
        version: state.version + 1,
      };
  }
}

export function isExpired(state: ApprovalState): boolean {
  return state.status === "pending" && new Date() > state.expiresAt;
}
