import type { SkillToolOperation } from "./types.js";

export type GovernanceTier = "read" | "internal_write" | "external_write" | "destructive";
export type TrustLevel = "supervised" | "guided" | "autonomous";
export type GovernanceDecision = "auto-approve" | "require-approval" | "deny";
export type GovernanceOutcome = "auto-approved" | "require-approval" | "denied";

export const GOVERNANCE_POLICY: Record<GovernanceTier, Record<TrustLevel, GovernanceDecision>> = {
  read: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  internal_write: {
    supervised: "require-approval",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  external_write: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "require-approval",
  },
  destructive: {
    supervised: "deny",
    guided: "require-approval",
    autonomous: "require-approval",
  },
};

export function getToolGovernanceDecision(
  op: SkillToolOperation,
  trustLevel: TrustLevel,
): GovernanceDecision {
  if (op.governanceOverride?.[trustLevel]) {
    return op.governanceOverride[trustLevel]!;
  }
  return GOVERNANCE_POLICY[op.governanceTier][trustLevel];
}

export function mapDecisionToOutcome(decision: GovernanceDecision): GovernanceOutcome {
  switch (decision) {
    case "auto-approve":
      return "auto-approved";
    case "require-approval":
      return "require-approval";
    case "deny":
      return "denied";
  }
}

export interface GovernanceLogEntry {
  operationId: string;
  tier: GovernanceTier;
  trustLevel: TrustLevel;
  decision: GovernanceDecision;
  overridden: boolean;
  timestamp: string;
}
