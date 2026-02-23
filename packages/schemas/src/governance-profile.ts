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
