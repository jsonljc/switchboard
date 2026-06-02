/**
 * Canonical governance config that enabling Mira-creative installs for an org so
 * the creative spend-approval gate is REAL. Two pieces, both required:
 *
 *  1. CREATIVE_GOVERNANCE_SETTINGS — written to `AgentDeployment.governanceSettings`.
 *     `trustLevelOverride:"autonomous"` + `spendAutonomy:true` are exactly what the
 *     GovernanceGate spend-approval lever (`applySpendApprovalThreshold`, #788) reads;
 *     without both, the `spendApprovalThreshold` column is inert. The threshold VALUE
 *     stays the column default ($50, operator-tunable) — this only opts the deployment
 *     into the lever.
 *  2. buildCreativeAllowPolicyInput — an org-scoped allow Policy for the creative
 *     pipeline intents. A workflow intent (`creative.job.*`) matches no other seeded
 *     policy, so the policy engine default-denies it; this policy makes creative
 *     generation governed-by-the-spend-threshold instead of hard-denied.
 *
 * Shared by the seed AND the real-gate test (apps/api) so the two cannot drift
 * (see feedback_safety_gate_needs_producer_population — a gate is only real when the
 * real producer/seed populates what it reads).
 */

/** Posture written to `AgentDeployment.governanceSettings` (a JSON column). */
export const CREATIVE_GOVERNANCE_SETTINGS = {
  trustLevelOverride: "autonomous" as const,
  spendAutonomy: true as const,
};

/** Rule matching the creative pipeline intents (submit / continue / stop). */
export const CREATIVE_ALLOW_POLICY_RULE = {
  conditions: [{ field: "actionType", operator: "matches" as const, value: "creative.job.*" }],
};

export function creativeAllowPolicyId(organizationId: string): string {
  return `policy_allow_creative_${organizationId}`;
}

/** Prisma upsert create/update payload for the org-scoped creative allow policy. */
export function buildCreativeAllowPolicyInput(organizationId: string) {
  return {
    id: creativeAllowPolicyId(organizationId),
    name: "Allow creative pipeline actions",
    description:
      "Creative generation/continue/stop are governed by the spend-approval threshold, not hard-denied.",
    organizationId,
    priority: 50,
    active: true,
    rule: CREATIVE_ALLOW_POLICY_RULE,
    effect: "allow",
  };
}
