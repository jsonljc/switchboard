/**
 * Canonical governance config for Riley's Phase-C pause self-execution
 * (`adoptimizer.campaign.pause`). Two policies, both required, mirroring
 * recommendation-handoff-governance.ts:
 *
 *  1. allow policy - a workflow intent matches no other seeded policy, so the
 *     engine default-denies it. This org-scoped allow makes the pause governed
 *     (by the approval policy below) rather than hard-denied.
 *  2. require_approval(mandatory) policy - a Riley-initiated pause mutates live
 *     ad-platform spend state, so it ALWAYS parks for a human. "mandatory" is
 *     the load-bearing word: Riley's deployment is seeded
 *     trustLevelOverride:"autonomous", and the spend-approval autonomy lever
 *     (spend-approval-threshold.ts) relaxes ONLY approvalLevel "standard"
 *     decisions; mandatory survives it (and a pause carries no spendAmount
 *     anyway). NOT system_auto_approved.
 *
 * NEVER seed one without the other: allow alone would EXECUTE the pause with no
 * human (the riley-pause-gate test pins this decomposition); approval alone
 * default-denies.
 *
 * Both rules are anchored + escaped: the rule-evaluator does an unanchored
 * `new RegExp(value).test(actionType)`.
 *
 * Shared by the seed (seed-riley-ad-optimizer-deployment.ts) AND the apps/api
 * real-gate test so the two cannot drift.
 */

export const RILEY_PAUSE_ALLOW_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.campaign\\.pause$",
    },
  ],
};

export function rileyPauseAllowPolicyId(organizationId: string): string {
  return `policy_allow_riley_pause_${organizationId}`;
}

export function buildRileyPauseAllowPolicyInput(organizationId: string) {
  return {
    id: rileyPauseAllowPolicyId(organizationId),
    name: "Allow Riley campaign-pause self-submission",
    description:
      "Riley's governed pause self-submission is governed by mandatory approval, not hard-denied.",
    organizationId,
    priority: 50,
    active: true,
    rule: RILEY_PAUSE_ALLOW_POLICY_RULE,
    effect: "allow",
  };
}

export const RILEY_PAUSE_APPROVAL_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.campaign\\.pause$",
    },
  ],
};

export function rileyPauseApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_riley_pause_${organizationId}`;
}

/**
 * Org-scoped mandatory-approval policy for the pause - the REAL gate that keeps
 * a human between Riley's intent and the Meta write.
 */
export function buildRileyPauseApprovalPolicyInput(organizationId: string) {
  return {
    id: rileyPauseApprovalPolicyId(organizationId),
    name: "Require human approval for a Riley campaign pause",
    description:
      "A Riley-initiated campaign pause mutates live ad spend state and always requires mandatory human approval.",
    organizationId,
    priority: 40,
    active: true,
    rule: RILEY_PAUSE_APPROVAL_POLICY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}
