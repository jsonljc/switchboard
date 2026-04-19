import type { SkillToolOperation } from "./types.js";

export type EffectCategory =
  | "read"
  | "propose"
  | "simulate"
  | "write"
  | "external_send"
  | "external_mutation"
  | "irreversible";

/** @deprecated Use `EffectCategory` instead. Kept as alias during migration. */
export type GovernanceTier = EffectCategory;

export type TrustLevel = "supervised" | "guided" | "autonomous";
export type GovernanceDecision = "auto-approve" | "require-approval" | "deny";
export type GovernanceOutcome = "auto-approved" | "require-approval" | "denied";

export const GOVERNANCE_POLICY: Record<EffectCategory, Record<TrustLevel, GovernanceDecision>> = {
  read: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  propose: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  simulate: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  write: {
    supervised: "require-approval",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  external_send: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "auto-approve",
  },
  external_mutation: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "auto-approve",
  },
  irreversible: {
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
  tier: EffectCategory;
  trustLevel: TrustLevel;
  decision: GovernanceDecision;
  overridden: boolean;
  timestamp: string;
}
