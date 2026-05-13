import type { SkillToolOperation } from "./types.js";
import type {
  EffectCategory,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
} from "./governance-types.js";

// Re-export all types so existing consumers of governance.ts don't break
export type {
  EffectCategory,
  GovernanceTier,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
  GovernanceLogEntry,
} from "./governance-types.js";

export const GOVERNANCE_POLICY: Record<EffectCategory, Record<TrustLevel, GovernanceDecision>> = {
  read: { supervised: "auto-approve", guided: "auto-approve", autonomous: "auto-approve" },
  propose: { supervised: "auto-approve", guided: "auto-approve", autonomous: "auto-approve" },
  simulate: { supervised: "auto-approve", guided: "auto-approve", autonomous: "auto-approve" },
  write: { supervised: "require-approval", guided: "auto-approve", autonomous: "auto-approve" },
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
  irreversible: { supervised: "deny", guided: "require-approval", autonomous: "require-approval" },
};

export function getToolGovernanceDecision(
  op: SkillToolOperation,
  trustLevel: TrustLevel,
): GovernanceDecision {
  if (op.governanceOverride?.[trustLevel]) {
    return op.governanceOverride[trustLevel]!;
  }
  return GOVERNANCE_POLICY[op.effectCategory][trustLevel];
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
