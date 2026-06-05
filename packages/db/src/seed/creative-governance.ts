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

/**
 * Rule matching ONLY the publish intent. Anchored + escaped: the rule-evaluator
 * does an unanchored `new RegExp(value).test(actionType)`, so anchoring guarantees
 * this fires on "creative.job.publish" exactly and never on submit/continue/stop
 * (which the allow policy above governs by spend threshold instead).
 */
export const CREATIVE_PUBLISH_APPROVAL_POLICY_RULE = {
  conditions: [
    { field: "actionType", operator: "matches" as const, value: "^creative\\.job\\.publish$" },
  ],
};

export function creativePublishApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_creative_publish_${organizationId}`;
}

/**
 * Org-scoped mandatory-approval policy for `creative.job.publish` — the REAL
 * claim-safety gate. `approvalPolicy` on the intent registration is decorative
 * (the policy engine never reads it); this policy sets `policyApprovalOverride`,
 * which the engine DOES enforce. "mandatory" is also immune to the #788
 * spend-approval downgrade (which only relaxes "standard"). Must be seeded
 * together with the allow policy (see seed-mira-creative-deployment.ts) — an org
 * allowed but not gated would auto-publish.
 */
export function buildCreativePublishApprovalPolicyInput(organizationId: string) {
  return {
    id: creativePublishApprovalPolicyId(organizationId),
    name: "Require human approval to publish a creative as a paused Meta draft",
    description:
      "Publishing a creative as a paused Meta draft package always requires mandatory human approval (medspa claim safety).",
    organizationId,
    priority: 40,
    active: true,
    rule: CREATIVE_PUBLISH_APPROVAL_POLICY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}

/**
 * Rule matching ONLY the slice-4 brain compose intent (anchored + escaped,
 * same rationale as the publish rule above: the rule-evaluator regex is
 * unanchored). The creative allow policy matches creative job intents only,
 * so the compose intent default-denies without this. Compose is read-class
 * reasoning whose only downstream artifact is a draft-only concept row, so
 * the effect is allow, NOT system_auto_approved: a real policy row keeps the
 * per-org governance dial (an org-scoped deny or require_approval policy can
 * throttle Mira the day an operator wants her quieter). Slice-4 spec 3.5.
 */
export const CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE = {
  conditions: [
    { field: "actionType", operator: "matches" as const, value: "^creative\\.brief\\.compose$" },
  ],
};

export function creativeBriefComposeAllowPolicyId(organizationId: string): string {
  return `policy_allow_creative_brief_compose_${organizationId}`;
}

export function buildCreativeBriefComposeAllowPolicyInput(organizationId: string) {
  return {
    id: creativeBriefComposeAllowPolicyId(organizationId),
    name: "Allow Mira brief compose",
    description:
      "Mira's brief-compose reasoning step is allowed; its only artifact is a draft-only concept row a human later funds.",
    organizationId,
    priority: 50,
    active: true,
    rule: CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE,
    effect: "allow",
  };
}
