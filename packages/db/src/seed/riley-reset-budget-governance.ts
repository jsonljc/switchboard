/**
 * Canonical governance config for Riley's automated reset-to-prior rollback
 * (`adoptimizer.campaign.reset_prior_budget`). ONE policy, deliberately ALLOW-ONLY:
 *
 * Unlike the forward reallocate seed (allow + require_approval(mandatory)), the rollback is an
 * automated safety reversal to a value a human already approved as the "from", so it MUST execute
 * without a human. The lone allow policy clears the engine's default-deny and resolves the intent to
 * "execute" (no park). It is NOT system_auto_approved (it uses the policy-engine allow path), so the
 * D9-2 FINANCIAL_AUTO_APPROVE_DENYLIST does not gate it and the reset is deliberately absent from
 * that list. The reset is structurally bounded elsewhere (the executor can only write the captured
 * prior `targetCents`), which is what makes auto-execution safe.
 *
 * The rule is anchored + escaped: the rule-evaluator does an unanchored
 * `new RegExp(value).test(actionType)`.
 *
 * Shared by the seed (seed-riley-ad-optimizer-deployment.ts) AND the apps/api real-gate test so the
 * two cannot drift.
 */

import type { PrismaDbClient } from "../prisma-db.js";

export const RILEY_RESET_BUDGET_ALLOW_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.campaign\\.reset_prior_budget$",
    },
  ],
};

export function rileyResetBudgetAllowPolicyId(organizationId: string): string {
  return `policy_allow_riley_reset_budget_${organizationId}`;
}

export function buildRileyResetBudgetAllowPolicyInput(organizationId: string) {
  return {
    id: rileyResetBudgetAllowPolicyId(organizationId),
    name: "Allow Riley automated reset-to-prior budget rollback",
    description:
      "Riley's automated guardrail rollback restores a captured prior budget and auto-executes (allow-only): it is a safety reversal, never a new spend decision.",
    organizationId,
    priority: 50,
    active: true,
    rule: RILEY_RESET_BUDGET_ALLOW_POLICY_RULE,
    effect: "allow",
  };
}

/**
 * Seed the allow-only reset policy. Idempotent on the deterministic per-org policy id; safe to re-run.
 * The caller owns the transaction boundary (provisionOrgAgentDeployments passes the tx client). There
 * is no sibling require_approval policy ON PURPOSE: a require_approval here would park the automated
 * safety reversal behind a human, which defeats the rollback.
 */
export async function seedRileyResetBudgetPolicies(
  client: PrismaDbClient,
  organizationId: string,
): Promise<void> {
  const { id: allowId, ...allowData } = buildRileyResetBudgetAllowPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id: allowId },
    create: { id: allowId, ...allowData },
    update: allowData,
  });
}
