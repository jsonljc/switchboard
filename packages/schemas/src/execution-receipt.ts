import { z } from "zod";

/**
 * Spec-1B (close-the-revenue-loop §3.2): the SUCCESS artifact of an executed campaign budget
 * reallocation. Layer 1 persisted data — the L5 executor populates it, the L4 store writes it to
 * WorkTrace.executionOutputs, and a replay reads it back to short-circuit (no second Meta call).
 * It is a success-only artifact: clean fail-closed paths write NO receipt (the reason code carries
 * the failure). Money fields are SAFE POSITIVE integer cents (a budget is strictly positive and must
 * never overflow the safe-integer range); the signed delta is the one field that may be negative.
 */
const PositiveSafeCents = z.number().int().safe().positive();

export const ExecutionReceiptSchema = z.object({
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

export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;
