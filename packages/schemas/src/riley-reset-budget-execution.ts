import { z } from "zod";

/**
 * The FROZEN parameters the automated reset-to-prior rollback executor replays.
 * `buildRileyResetBudgetSubmitRequest` (apps/api) writes these into the canonical work unit's
 * parameters; the executor parses them before any Meta call. `targetCents` is the captured prior to
 * restore to (a SAFE POSITIVE integer; a daily budget is strictly positive). `deploymentId` is the
 * ORIGINAL reallocation's deployment, which the executor resolves credentials from (the reset itself
 * resolves into a platform-direct context with no usable deployment). `breachMetric`/`breachReason`
 * are recorded on the reset receipt for the audit trail.
 */
const PositiveSafeCents = z.number().int().safe().positive();

export const RileyResetBudgetExecutionInput = z.object({
  deploymentId: z.string().min(1),
  adAccountId: z.string().min(1),
  campaignId: z.string().min(1),
  targetCents: PositiveSafeCents,
  rollbackOfWorkUnitId: z.string().min(1),
  breachMetric: z.enum(["account_booked_conversions_drop_share", "freed_budget_absorbed_share"]),
  breachReason: z.enum(["exceeded", "unmeasured"]),
});
export type RileyResetBudgetExecutionInput = z.infer<typeof RileyResetBudgetExecutionInput>;
