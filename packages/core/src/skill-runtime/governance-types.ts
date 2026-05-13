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

export interface GovernanceLogEntry {
  operationId: string;
  tier: EffectCategory;
  trustLevel: TrustLevel;
  decision: GovernanceDecision;
  overridden: boolean;
  timestamp: string;
}
