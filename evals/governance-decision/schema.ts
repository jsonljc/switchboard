import { z } from "zod";

/**
 * Governance-decision eval fixture schema.
 *
 * These enums mirror the runtime types in `@switchboard/core/skill-runtime`
 * (`EffectCategory`, `TrustLevel`, `GovernanceDecision`). They are duplicated as
 * runtime Zod enums (the core package exports the TYPES, not runtime enum
 * arrays). A drift guard in the test asserts the fixture grid covers exactly the
 * keys present in the live `GOVERNANCE_POLICY`, so any new effect category /
 * trust level in core surfaces as a failing test rather than silent under-coverage.
 */

export const EffectCategoryEnum = z.enum([
  "read",
  "propose",
  "simulate",
  "write",
  "external_send",
  "external_mutation",
  "irreversible",
]);
export type EffectCategoryLabel = z.infer<typeof EffectCategoryEnum>;

export const TrustLevelEnum = z.enum(["supervised", "guided", "autonomous"]);
export type TrustLevelLabel = z.infer<typeof TrustLevelEnum>;

export const GovernanceDecisionEnum = z.enum(["auto-approve", "require-approval", "deny"]);
export type GovernanceDecisionLabel = z.infer<typeof GovernanceDecisionEnum>;

export const GovernanceCaseSchema = z.object({
  /** Unique slug (kebab-case). Used in the report. */
  id: z.string().min(1),
  /** The tool operation's effect category. */
  effectCategory: EffectCategoryEnum,
  /** The deployment's resolved trust level. */
  trustLevel: TrustLevelEnum,
  /**
   * Optional per-trust-level override the operation declares. When the override
   * covers `trustLevel` it wins over the base policy; otherwise the base policy
   * applies. Mirrors `SkillToolOperation.governanceOverride`.
   */
  governanceOverride: z.record(TrustLevelEnum, GovernanceDecisionEnum).optional(),
  /** The decision the live gate MUST return for this case. */
  expectedDecision: GovernanceDecisionEnum,
  /** Free-text justification for human reviewers. */
  notes: z.string().optional(),
});
export type GovernanceCase = z.infer<typeof GovernanceCaseSchema>;
