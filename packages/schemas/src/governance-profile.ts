import { z } from "zod";

/**
 * Governance profile: per-org "dial" of intensity.
 * Maps to system risk posture and influences approval strictness (no new code paths).
 */
export const GovernanceProfileSchema = z.enum([
  "observe",   // Most permissive; normal posture
  "guarded",   // Normal guardrails, default posture
  "strict",    // Elevated posture; more approvals
  "locked",    // Critical posture; mandatory approvals
]);
export type GovernanceProfile = z.infer<typeof GovernanceProfileSchema>;

/**
 * Extended governance profile configuration for per-org tool restrictions.
 * allowedActionTypes is a whitelist (if set, only these action types are permitted).
 * blockedActionTypes is a blacklist (these action types are denied).
 * allowedActionTypes takes precedence: if set, blockedActionTypes is ignored.
 */
export const GovernanceProfileConfigSchema = z.object({
  profile: GovernanceProfileSchema,
  allowedActionTypes: z.array(z.string()).optional(),
  blockedActionTypes: z.array(z.string()).optional(),
});
export type GovernanceProfileConfig = z.infer<typeof GovernanceProfileConfigSchema>;
