/**
 * Canonical governance for the platform-initiated PROACTIVE + LEAD-INTAKE intent family: the
 * conversation reminder / follow-up sends, the Meta first-touch greeting, the lead inquiry record,
 * and the lead.intake + meta.lead.intake intake handlers.
 *
 * A workflow intent that matches no seeded policy is DEFAULT-DENIED by the PolicyEngine
 * (policy-engine.ts: `finalDecision = policyDecision ?? "deny"`), and the seeded `system` principal
 * carries no trust behaviors — so without this allow these intents ship prod-inert by DENY even
 * after the deployment-resolution carve-out gets them TO the gate. This org-scoped allow makes the
 * family governed rather than hard-denied.
 *
 * ALLOW-ONLY by design — deliberately NOT Robin's allow + mandatory-approval pair. Each send is a
 * single transactional 1:1 message already gated downstream by consent + the 24h customer-care
 * window + template approval (proactive-eligibility.ts), and lead intake/record is a non-financial
 * write. A require_approval here would strand every reminder and every inbound lead unapproved.
 *
 * One policy, one anchored alternation rule over the family's actionTypes (the gate matches
 * `proposal.actionType === workUnit.intent`). The rule-evaluator runs an unanchored
 * `new RegExp(value).test(actionType)`, so the value is anchored `^(...)$` and every dot escaped.
 *
 * Shared by the seed (provision-org-agents.ts always-run branch + prisma/seed.ts org_dev) AND the
 * apps/api real-gate live-path test, so the producer and the proof cannot drift.
 */

import type { PrismaDbClient } from "../prisma-db.js";

export const PROACTIVE_INTAKE_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value:
        "^(conversation\\.reminder\\.send|conversation\\.followup\\.send|meta\\.lead\\.greeting\\.send|meta\\.lead\\.inquiry\\.record|lead\\.intake|meta\\.lead\\.intake)$",
    },
  ],
};

export function proactiveIntakeAllowPolicyId(organizationId: string): string {
  return `policy_allow_proactive_intake_${organizationId}`;
}

export function buildProactiveIntakeAllowPolicyInput(organizationId: string) {
  return {
    id: proactiveIntakeAllowPolicyId(organizationId),
    name: "Allow platform-initiated proactive sends and lead intake",
    description:
      "Transactional reminder / follow-up / greeting sends, lead inquiry records, and lead intake are governed downstream (consent / 24h window / template), not hard-denied by the default-deny.",
    organizationId,
    priority: 50,
    active: true,
    rule: PROACTIVE_INTAKE_POLICY_RULE,
    effect: "allow",
  };
}

/**
 * Seed the single allow policy. Idempotent on the deterministic per-org policy id; safe to re-run on
 * every hot-path provision call. The caller owns the transaction boundary
 * (provisionOrgAgentDeployments passes the tx client from its `$transaction`).
 */
export async function seedProactiveIntakePolicies(
  client: PrismaDbClient,
  organizationId: string,
): Promise<void> {
  const { id, ...data } = buildProactiveIntakeAllowPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
}
