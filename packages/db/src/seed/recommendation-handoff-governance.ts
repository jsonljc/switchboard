/**
 * Canonical governance config for the Riley -> agent advisory handoff
 * (`adoptimizer.recommendation.handoff`, Governed Handoff Contract Freeze §4.3).
 * Two policies, both required, mirroring creative-governance.ts:
 *
 *  1. allow policy - a workflow intent matches no other seeded policy, so the
 *     engine default-denies it. This org-scoped allow makes the handoff governed
 *     (by the approval policy below) rather than hard-denied.
 *  2. require_approval(mandatory) policy - a Riley-initiated handoff can lead to
 *     creative spend (it creates a Mira draft a human then funds), so the handoff
 *     ALWAYS parks for a human. `approvalPolicy` on the intent registration is
 *     decorative; this policy sets policyApprovalOverride, which the engine
 *     enforces. "mandatory" is non-downgradeable (immune to the #788 relax) and,
 *     critically, this is NOT system_auto_approved (which would short-circuit the
 *     gate before the spend post-processor).
 *
 * Both rules are anchored + escaped: the rule-evaluator does an unanchored
 * `new RegExp(value).test(actionType)`, so `^...$` guarantees they fire on
 * "adoptimizer.recommendation.handoff" exactly and never on a substring match.
 *
 * Shared by the seed (seed-mira-creative-deployment.ts) AND the apps/api
 * real-gate test so the two cannot drift.
 */

/** Rule matching the handoff intent (allow). */
export const RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.recommendation\\.handoff$",
    },
  ],
};

export function recommendationHandoffAllowPolicyId(organizationId: string): string {
  return `policy_allow_recommendation_handoff_${organizationId}`;
}

/** Prisma upsert create/update payload for the org-scoped handoff allow policy. */
export function buildRecommendationHandoffAllowPolicyInput(organizationId: string) {
  return {
    id: recommendationHandoffAllowPolicyId(organizationId),
    name: "Allow Riley->agent recommendation handoff",
    description:
      "The Riley advisory->action handoff is governed by mandatory approval, not hard-denied.",
    organizationId,
    priority: 50,
    active: true,
    rule: RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE,
    effect: "allow",
  };
}

/** Rule matching ONLY the handoff intent (anchored + escaped). */
export const RECOMMENDATION_HANDOFF_APPROVAL_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.recommendation\\.handoff$",
    },
  ],
};

export function recommendationHandoffApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_recommendation_handoff_${organizationId}`;
}

/**
 * Org-scoped mandatory-approval policy for the handoff - the REAL gate that keeps
 * Riley advisory. Must be seeded TOGETHER with the allow policy: an org allowed
 * but not gated would auto-route Riley recommendations into Mira drafts with no
 * human in the loop.
 */
export function buildRecommendationHandoffApprovalPolicyInput(organizationId: string) {
  return {
    id: recommendationHandoffApprovalPolicyId(organizationId),
    name: "Require human approval for a Riley->agent recommendation handoff",
    description:
      "A Riley-initiated handoff that can lead to creative spend always requires mandatory human approval.",
    organizationId,
    priority: 40,
    active: true,
    rule: RECOMMENDATION_HANDOFF_APPROVAL_POLICY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}
