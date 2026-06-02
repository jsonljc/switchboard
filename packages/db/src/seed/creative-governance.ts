/**
 * Canonical governance config the per-org creative-deployment seed
 * (`seedMiraCreativeDeployment`) installs so the creative spend-approval gate is
 * REAL for that org. Three pieces, all required:
 *
 *  1. CREATIVE_GOVERNANCE_SETTINGS — written to `AgentDeployment.governanceSettings`.
 *     `trustLevelOverride:"autonomous"` + `spendAutonomy:true` are exactly what the
 *     GovernanceGate spend-approval lever (`applySpendApprovalThreshold`, #788) reads;
 *     without both, the threshold is inert (the lever stays dormant).
 *  2. CREATIVE_SPEND_APPROVAL_THRESHOLD — written to the `spendApprovalThreshold`
 *     column. The non-nullable column default ($50) sits ABOVE realistic render
 *     costs (~$1–21: Kling $0.35–0.70/scene × ≤6 scenes × ≤5 scripts), so leaving it
 *     would keep the gate dormant in practice. This creative-scaled value lets a
 *     large/long multi-script batch park while a small clip auto-runs. Operator-tunable.
 *  3. buildCreativeAllowPolicyInput — an org-scoped allow Policy for the creative
 *     pipeline intents. A workflow intent (`creative.job.*`) matches no other seeded
 *     policy, so the policy engine default-denies it; this policy makes creative
 *     generation governed-by-the-spend-threshold instead of hard-denied.
 *
 * NOTE on enablement: this is the PER-ORG install function's config. Today the dev
 * seed runs it for `org_dev`; wiring it into the per-org pilot-enablement path
 * (`seedMiraPilotOrgs` only flips OrgAgentEnablement) is the separate, pending
 * Mira pilot-enablement workstream — until that lands, a pilot org needs
 * `seedMiraCreativeDeployment(org)` run explicitly or `creative.job.*` default-denies.
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

/**
 * Creative render-spend cap (dollars) written to `AgentDeployment.spendApprovalThreshold`.
 * Renders estimated above this park for approval; at/under auto-run. Scaled to the
 * creative cost model (a single basic clip is ~$1–4; a large 5-script batch ~$21), so
 * the gate is demonstrably live, NOT the dormant $50 column default. Tune per pilot.
 */
export const CREATIVE_SPEND_APPROVAL_THRESHOLD = 15;

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
