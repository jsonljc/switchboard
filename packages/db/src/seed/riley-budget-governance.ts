/**
 * Canonical governance config for Riley's Spec-1B budget reallocation
 * (`adoptimizer.campaign.reallocate`). Two policies, both required, mirroring
 * riley-pause-governance.ts:
 *
 *  1. allow policy - a workflow intent matches no other seeded policy, so the
 *     engine default-denies it. This org-scoped allow makes the reallocation
 *     governed (by the approval policy below) rather than hard-denied.
 *  2. require_approval(mandatory) policy - a Riley-initiated reallocation MOVES
 *     real ad budget (and carries a spendAmount), so it ALWAYS parks for a human.
 *     "mandatory" is load-bearing: Riley's deployment is seeded
 *     trustLevelOverride:"autonomous", and the spend-approval autonomy lever
 *     relaxes ONLY approvalLevel "standard" decisions; mandatory survives it. The
 *     reallocate intent is ALSO on the D9-2 FINANCIAL_AUTO_APPROVE_DENYLIST, so it
 *     can never ride the system_auto_approved short-circuit either.
 *
 * NEVER seed one without the other: allow alone would EXECUTE the reallocation with
 * no human; approval alone default-denies.
 *
 * Both rules are anchored + escaped: the rule-evaluator does an unanchored
 * `new RegExp(value).test(actionType)`.
 *
 * Shared by the seed (seed-riley-ad-optimizer-deployment.ts) AND the apps/api
 * real-gate test so the two cannot drift.
 */

import type { PrismaDbClient } from "../prisma-db.js";

export const RILEY_REALLOCATE_ALLOW_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.campaign\\.reallocate$",
    },
  ],
};

export function rileyReallocateAllowPolicyId(organizationId: string): string {
  return `policy_allow_riley_reallocate_${organizationId}`;
}

export function buildRileyReallocateAllowPolicyInput(organizationId: string) {
  return {
    id: rileyReallocateAllowPolicyId(organizationId),
    name: "Allow Riley campaign-budget reallocation self-submission",
    description:
      "Riley's governed budget reallocation is governed by mandatory approval, not hard-denied.",
    organizationId,
    priority: 50,
    active: true,
    rule: RILEY_REALLOCATE_ALLOW_POLICY_RULE,
    effect: "allow",
  };
}

export const RILEY_REALLOCATE_APPROVAL_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.campaign\\.reallocate$",
    },
  ],
};

export function rileyReallocateApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_riley_reallocate_${organizationId}`;
}

/**
 * Org-scoped mandatory-approval policy for the reallocation - the REAL gate that keeps a human
 * between Riley's intent and the live Meta budget write.
 */
export function buildRileyReallocateApprovalPolicyInput(organizationId: string) {
  return {
    id: rileyReallocateApprovalPolicyId(organizationId),
    name: "Require human approval for a Riley campaign-budget reallocation",
    description:
      "A Riley-initiated budget reallocation moves live ad spend and always requires mandatory human approval.",
    organizationId,
    priority: 40,
    active: true,
    rule: RILEY_REALLOCATE_APPROVAL_POLICY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}

/**
 * Seed the allow + mandatory-approval reallocation policies as a single BOTH-OR-NEITHER unit
 * (mirrors seedRileyPausePolicies). They are load-bearing together: allow alone would EXECUTE the
 * money move with no human; approval alone default-denies. The caller owns the transaction boundary
 * (provisionOrgAgentDeployments passes the tx client from its `$transaction`) so a crash between the
 * two upserts can never leave allow-alone; a thrown upsert propagates so the surrounding transaction
 * rolls back both. Idempotent on the deterministic per-org policy ids; safe to re-run.
 */
export async function seedRileyReallocatePolicies(
  client: PrismaDbClient,
  organizationId: string,
): Promise<void> {
  const { id: allowId, ...allowData } = buildRileyReallocateAllowPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id: allowId },
    create: { id: allowId, ...allowData },
    update: allowData,
  });

  const { id: approvalId, ...approvalData } =
    buildRileyReallocateApprovalPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id: approvalId },
    create: { id: approvalId, ...approvalData },
    update: approvalData,
  });
}
