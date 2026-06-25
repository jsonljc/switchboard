import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import type { BlastRadiusGuardrailMetric, GuardrailBreach } from "@switchboard/ad-optimizer";

/**
 * The governed automated-rollback intent. Restores a campaign's daily budget to the prior the
 * forward reallocate executor captured, after the guardrail monitor trips. Registered in
 * bootstrap/contained-workflows.ts, gated by the seeded ALLOW-ONLY policy
 * (packages/db/src/seed/riley-reset-budget-governance.ts), and resolved PLATFORM_DIRECT (its
 * `adoptimizer` slug has no seeded deployment). Unlike the forward reallocate intent it AUTO-EXECUTES
 * (no human, no park): an automated rollback is a safety reversal to a value a human already approved
 * as the "from". It is NEVER system_auto_approved (it uses the policy-engine allow path), so the D9-2
 * FINANCIAL_AUTO_APPROVE_DENYLIST does not apply and the reset is deliberately absent from it.
 */
export const RILEY_RESET_PRIOR_BUDGET_INTENT = "adoptimizer.campaign.reset_prior_budget";

export interface RileyResetBudgetSubmitInput {
  organizationId: string;
  /** The ORIGINAL reallocation's deployment: the reset executor resolves credentials from this, not
   *  from the platform-direct context the reset resolves into. */
  deploymentId: string;
  adAccountId: string;
  campaignId: string;
  /** The captured prior to restore to (the forward move's observedPriorCents). */
  targetCents: number;
  /** The forward reallocation execution work unit this reset reverses. */
  rollbackOfWorkUnitId: string;
  breachMetric: BlastRadiusGuardrailMetric;
  breachReason: GuardrailBreach["reason"];
}

/**
 * Build the canonical submit request for the automated reset-to-prior rollback. Mirrors
 * buildRileyBudgetSubmitRequest's conventions, with three deliberate differences:
 *  - NO targetHint: the resolver derives skillSlug `adoptimizer` (no seeded deployment), so the
 *    PLATFORM_DIRECT_WORKFLOW_INTENTS carve-out resolves it platform-direct (the honest attribution:
 *    the platform reverses Riley's move). The executor resolves credentials from the FROZEN
 *    `deploymentId` in parameters, never the platform-direct context.
 *  - NO spendAmount: a restore is not an outbound spend decision; omitting it keeps the spend-approval
 *    gate from parking the safety reversal. The structural bound is `targetCents` = the captured prior.
 *  - idempotency key `reset:<forwardWorkUnitId>`: at most one reset per forward move (a re-dispatch on
 *    a retried monitor pass is deduped at ingress).
 *
 * Returns null when `targetCents` is not a strictly-positive safe integer (never restore garbage).
 */
export function buildRileyResetBudgetSubmitRequest(
  input: RileyResetBudgetSubmitInput,
): CanonicalSubmitRequest | null {
  if (!Number.isSafeInteger(input.targetCents) || input.targetCents <= 0) return null;

  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: RILEY_RESET_PRIOR_BUDGET_INTENT,
    parameters: {
      deploymentId: input.deploymentId,
      adAccountId: input.adAccountId,
      campaignId: input.campaignId,
      targetCents: input.targetCents,
      rollbackOfWorkUnitId: input.rollbackOfWorkUnitId,
      breachMetric: input.breachMetric,
      breachReason: input.breachReason,
    },
    trigger: "internal",
    surface: { surface: "api" },
    idempotencyKey: `reset:${input.rollbackOfWorkUnitId}`,
  };
}
