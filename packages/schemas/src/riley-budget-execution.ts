import { z } from "zod";

/**
 * Spec-1B (close-the-revenue-loop §3.4): the FROZEN, human-approved parameters the reallocate
 * executor replays. Layer 1. `buildRileyBudgetSubmitRequest` (apps/api) writes these into the
 * canonical work unit's parameters; the executor parses them here before any Meta call. Cents are
 * SAFE POSITIVE integers (a daily budget is strictly positive and must never overflow the
 * safe-integer range). `actionType` is pinned to the literal "scale" (the only reallocate action in
 * v1; decreases / review_budget are v2). Sibling fields on the same parameters (spendAmount,
 * rationale, evidence) serve the gate and audit, are intentionally NOT parsed here (zod strips
 * them), and the executor acts only on the frozen money move.
 */
const PositiveSafeCents = z.number().int().safe().positive();

export const RileyBudgetExecutionInput = z.object({
  recommendationId: z.string().min(1),
  actionType: z.literal("scale"),
  adAccountId: z.string().min(1),
  campaignId: z.string().min(1),
  fromCents: PositiveSafeCents,
  toCents: PositiveSafeCents,
});
export type RileyBudgetExecutionInput = z.infer<typeof RileyBudgetExecutionInput>;
