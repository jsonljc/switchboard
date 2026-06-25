import { z } from "zod";

/**
 * Spec-1B (close-the-revenue-loop §3.2): the SUCCESS artifact of an executed campaign budget move.
 * Layer 1 persisted data: the L5 executor populates it, the L4 store writes it to
 * WorkTrace.executionOutputs, and a replay reads it back to short-circuit (no second Meta call).
 * It is a success-only artifact: clean fail-closed paths write NO receipt (the reason code carries
 * the failure). Money fields are SAFE POSITIVE integer cents (a budget is strictly positive and must
 * never overflow the safe-integer range); the signed delta is the one field that may be negative.
 *
 * Discriminated on `kind`:
 *  - `campaign_budget_reallocation`: the human-approved forward move (carries the approval lifecycle).
 *  - `campaign_budget_reset`: the automated guardrail rollback restoring the captured prior (no human
 *    approval lifecycle: the monitor, not a human, triggered it).
 */
const PositiveSafeCents = z.number().int().safe().positive();

const CampaignBudgetReallocationReceiptSchema = z.object({
  kind: z.literal("campaign_budget_reallocation"),
  organizationId: z.string(),
  deploymentId: z.string(),
  /** The frozen, approved Meta ad-account (§3.4): the executor locks, reads spend, and stamps here. */
  adAccountId: z.string(),
  campaignId: z.string(),
  workTraceId: z.string(),
  /** The replay key: at most one Meta edit per execution work unit. */
  executionWorkUnitId: z.string(),
  approvedLifecycleId: z.string(),
  /** The frozen-payload content binding the human approved. */
  bindingHash: z.string(),
  requestedFromCents: PositiveSafeCents,
  requestedToCents: PositiveSafeCents,
  /** Live pre-write read (== from when there was no drift); the rollback's captured prior. */
  observedPriorCents: PositiveSafeCents,
  /** Post-write re-read (== to on success). */
  appliedCents: PositiveSafeCents,
  /** appliedCents - observedPriorCents; the one signed field (a decrease is negative). */
  deltaCentsSigned: z.number().int().safe(),
  executedAt: z.string().datetime(),
});

/**
 * The automated guardrail rollback's success artifact. The monitor restores the budget to the prior
 * the forward executor captured (`targetCents`). There is no `approvedLifecycleId` / `bindingHash` /
 * `requestedFromCents`: a reset has no human-approval lifecycle of its own (it is an allow-only safety
 * reversal). `rollbackOfWorkUnitId` names the forward reallocation it reversed; `breachMetric` /
 * `breachReason` record why the guardrail tripped. Money-field naming is reset-specific and honest:
 * `observedLiveCents` is the (drifted-up) budget read just before the reset, `targetCents` is the
 * captured prior restored to.
 */
const CampaignBudgetResetReceiptSchema = z.object({
  kind: z.literal("campaign_budget_reset"),
  organizationId: z.string(),
  deploymentId: z.string(),
  adAccountId: z.string(),
  campaignId: z.string(),
  /** The replay key for THIS reset execution work unit. The reset's canonical WorkTrace is reachable
   *  by this id; storing the traceId inside its own executionOutputs would be redundant (and risks the
   *  workUnitId/traceId conflation trap), so the reset receipt omits workTraceId. */
  executionWorkUnitId: z.string(),
  /** The forward reallocation execution work unit this reset reversed. */
  rollbackOfWorkUnitId: z.string(),
  breachMetric: z.enum(["account_booked_conversions_drop_share", "freed_budget_absorbed_share"]),
  breachReason: z.enum(["exceeded", "unmeasured"]),
  /** The captured prior the reset restores to (the forward move's observedPriorCents). */
  targetCents: PositiveSafeCents,
  /** The live budget read just before the reset write (the value being undone). */
  observedLiveCents: PositiveSafeCents,
  /** Post-write re-read (== targetCents on success). */
  appliedCents: PositiveSafeCents,
  /** appliedCents - observedLiveCents; negative when the reset undoes an increase. */
  deltaCentsSigned: z.number().int().safe(),
  executedAt: z.string().datetime(),
});

export const ExecutionReceiptSchema = z.discriminatedUnion("kind", [
  CampaignBudgetReallocationReceiptSchema,
  CampaignBudgetResetReceiptSchema,
]);

export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;
export type CampaignBudgetReallocationReceipt = z.infer<
  typeof CampaignBudgetReallocationReceiptSchema
>;
export type CampaignBudgetResetReceipt = z.infer<typeof CampaignBudgetResetReceiptSchema>;
