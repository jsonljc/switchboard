/**
 * Canonical governance config for Robin's no-show recovery campaign
 * (`robin.recovery_campaign.send`). Two policies, both required, mirroring
 * riley-budget-governance.ts:
 *
 *  1. allow policy - a workflow intent matches no other seeded policy, so the engine
 *     default-denies it. This org-scoped allow makes the recovery campaign governed (by
 *     the approval policy below) rather than hard-denied.
 *  2. require_approval(mandatory) policy - a recovery campaign is a mass proactive patient
 *     send, so it ALWAYS parks for a human. "mandatory" is load-bearing: it survives any
 *     deployment trust posture (the campaign resolves to a platform-direct context with no
 *     autonomy override, and mandatory survives even the autonomous spend lever).
 *
 * NEVER seed one without the other: allow alone would EXECUTE the campaign with no human;
 * approval alone default-denies.
 *
 * Both rules are anchored + escaped: the rule-evaluator does an unanchored
 * `new RegExp(value).test(actionType)`.
 *
 * Shared by the seed (provision-org-agents.ts / seed.ts) AND the apps/api real-gate test so the
 * two cannot drift.
 */

import type { PrismaDbClient } from "../prisma-db.js";

export const ROBIN_RECOVERY_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^robin\\.recovery_campaign\\.send$",
    },
  ],
};

export function robinRecoveryAllowPolicyId(organizationId: string): string {
  return `policy_allow_robin_recovery_${organizationId}`;
}

export function buildRobinRecoveryAllowPolicyInput(organizationId: string) {
  return {
    id: robinRecoveryAllowPolicyId(organizationId),
    name: "Allow Robin no-show recovery campaign self-submission",
    description:
      "Robin's governed recovery campaign is governed by mandatory approval, not hard-denied.",
    organizationId,
    priority: 50,
    active: true,
    rule: ROBIN_RECOVERY_POLICY_RULE,
    effect: "allow",
  };
}

export function robinRecoveryApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_robin_recovery_${organizationId}`;
}

/**
 * Org-scoped mandatory-approval policy for the recovery campaign - the REAL gate that keeps a human
 * between Robin's intent and any patient outreach.
 */
export function buildRobinRecoveryApprovalPolicyInput(organizationId: string) {
  return {
    id: robinRecoveryApprovalPolicyId(organizationId),
    name: "Require human approval for a Robin no-show recovery campaign",
    description:
      "A Robin recovery campaign is a mass proactive patient send and always requires mandatory human approval.",
    organizationId,
    priority: 40,
    active: true,
    rule: ROBIN_RECOVERY_POLICY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}

/**
 * Seed the allow + mandatory-approval recovery policies as a single BOTH-OR-NEITHER unit (mirrors
 * seedRileyReallocatePolicies). They are load-bearing together: allow alone would EXECUTE a mass
 * patient send with no human; approval alone default-denies. The caller owns the transaction
 * boundary (provisionOrgAgentDeployments passes the tx client from its `$transaction`) so a crash
 * between the two upserts can never leave allow-alone; a thrown upsert propagates so the
 * surrounding transaction rolls back both. Idempotent on the deterministic per-org policy ids;
 * safe to re-run on every hot-path provision call.
 */
export async function seedRobinRecoveryPolicies(
  client: PrismaDbClient,
  organizationId: string,
): Promise<void> {
  const { id: allowId, ...allowData } = buildRobinRecoveryAllowPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id: allowId },
    create: { id: allowId, ...allowData },
    update: allowData,
  });

  const { id: approvalId, ...approvalData } = buildRobinRecoveryApprovalPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id: approvalId },
    create: { id: approvalId, ...approvalData },
    update: approvalData,
  });
}
