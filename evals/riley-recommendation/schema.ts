import { z } from "zod";

/** One deterministic Riley decision case. Inputs are the exact `decideForCampaign`
 * inputs a fixture can express without a live Graph/CRM call; expectedOutcome is the
 * reduced label the harness asserts. */
export const RileyCaseSchema = z.object({
  id: z.string().min(1),
  current: z.object({
    impressions: z.number(),
    inlineLinkClicks: z.number(),
    spend: z.number(),
    conversions: z.number(),
    revenue: z.number(),
    frequency: z.number(),
  }),
  previous: z
    .object({
      impressions: z.number(),
      inlineLinkClicks: z.number(),
      spend: z.number(),
      conversions: z.number(),
      revenue: z.number(),
      frequency: z.number(),
    })
    .nullable(),
  targetBreach: z.object({
    periodsAboveTarget: z.number(),
    granularity: z.enum(["daily", "weekly"]),
  }),
  learningState: z.enum(["learning", "learning_limited", "success", "unknown"]),
  economicTier: z.enum(["booked_cac", "cpl", "cpc"]),
  effectiveTarget: z.number(),
  targetROAS: z.number(),
  /** Phase-A Gate 1: when false, the harness models a suspected account-wide
   * conversion-denominator step-change for this case, demoting cost-driven /
   * learning-resetting recs to watches. Omitted ⇒ measurement is trusted (true). */
  measurementTrusted: z.boolean().optional(),
  /** Reduced expected label (primary/back-compat assertion): an action name,
   * `watch`, `insight`, or `none`. */
  expectedOutcome: z.string().min(1),
  /** Optional set-membership assertion: every action listed here MUST appear among
   * the recommendation actions the engine produces. Pins multi-rec outcomes the
   * single `expectedOutcome` label can't — e.g. a durable breach emitting BOTH
   * `add_creative` AND `pause`, so a dropped `pause` fails the eval. */
  expectedActions: z.array(z.string().min(1)).optional(),
  /** Optional set-membership assertion: every watch pattern listed here MUST appear
   * among the watches the engine produces (e.g. `measurement_untrusted`). */
  expectedWatchPatterns: z.array(z.string().min(1)).optional(),
  /** PR2 Gate-4: when present, the harness resolves the per-campaign economic
   * target through the REAL resolveEconomicTargetForCampaign (Tier-1 the campaign's
   * own booking-calibrated CAC vs Tier-2 the account fallback) and feeds the result
   * into decideForCampaign — the exact live audit-runner seam. The flat
   * economicTier/effectiveTarget above then describe the resolution OUTPUT that a
   * non-hybrid case pins directly. */
  hybrid: z
    .object({
      campaignBookings: z.number(),
      campaignConversions: z.number(),
      targetCostPerBooked: z.number().optional(),
      accountTarget: z.object({
        economicTier: z.enum(["booked_cac", "cpl", "cpc"]),
        effectiveTarget: z.number(),
      }),
    })
    .optional(),
  /** Expected resolution source when `hybrid` is present (campaign Tier-1 vs
   * account Tier-2). */
  expectedTargetSource: z.enum(["campaign", "account"]).optional(),
  /** D7-2: optional per-action-kind operator approve/reject history. When present, the
   * harness builds the bounded, abstaining confidence modifier (confidenceModifierForKind)
   * and feeds it into decideForCampaign exactly as the live weekly audit does — proving the
   * learning wire end-to-end through the REAL engine, not a hand-built modifier. */
  approvalHistory: z
    .record(z.string(), z.object({ approved: z.number(), rejected: z.number() }))
    .optional(),
  /** D7-1: optional per-action-kind CORROBORATED-direction history ({ corroboratedUp,
   * corroboratedDown }). When present, the harness builds the bounded, abstaining outcome multiplier
   * (outcomeAdjustmentForKind) and composes it with the approval modifier in decideForCampaign,
   * exactly as the live audit does, proving the readback wire end-to-end through the REAL engine. */
  outcomeHistory: z
    .record(z.string(), z.object({ corroboratedUp: z.number(), corroboratedDown: z.number() }))
    .optional(),
  /** A12: optional count-vs-value gate input. When present, the harness passes it into
   * decideForCampaign exactly as the live audit-runner does (built only when the paid-value
   * provider is wired), proving the gate end-to-end through the REAL engine. `paidValueCents`
   * is the campaign's verified-paid (type="purchased") value for the window (cents), or null when
   * none is attributed; a null / non-finite / zero value fails the floor and demotes a `scale` rec
   * to a `scale_unproven_paid_value` watch (fail-closed). */
  paidValueGate: z.object({ paidValueCents: z.number().nullable() }).optional(),
  /** D7-2: optional per-action confidence assertions. The engine's emitted confidence for
   * the named action must satisfy the bound(s). `equals` pins an exact value (close to 5
   * decimals); `min`/`max` pin the bounded band. Proves the modifier moved (or abstained
   * on) the right kind by the right amount. */
  expectedConfidence: z
    .array(
      z.object({
        action: z.string().min(1),
        equals: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .optional(),
  notes: z.string().optional(),
});
export type RileyCase = z.infer<typeof RileyCaseSchema>;
