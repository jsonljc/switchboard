import type { ApprovalRequirement, RiskCategory } from "@switchboard/schemas";
import type { ResolvedIdentity } from "../identity/spec.js";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "patched";

export interface ApprovalState {
  status: ApprovalStatus;
  respondedBy: string | null;
  respondedAt: Date | null;
  patchValue: Record<string, unknown> | null;
  expiresAt: Date;
}

export function determineApprovalRequirement(
  riskCategory: RiskCategory,
  identity: ResolvedIdentity,
): ApprovalRequirement {
  return identity.effectiveRiskTolerance[riskCategory];
}

export function createApprovalState(expiresAt: Date): ApprovalState {
  return {
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
  };
}

export function transitionApproval(
  state: ApprovalState,
  action: "approve" | "reject" | "patch" | "expire",
  respondedBy?: string,
  patchValue?: Record<string, unknown>,
): ApprovalState {
  switch (action) {
    case "approve":
      if (state.status !== "pending") {
        throw new Error(`Cannot approve: current status is ${state.status}`);
      }
      return {
        ...state,
        status: "approved",
        respondedBy: respondedBy ?? null,
        respondedAt: new Date(),
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
      };
  }
}

export function isExpired(state: ApprovalState): boolean {
  return state.status === "pending" && new Date() > state.expiresAt;
}
