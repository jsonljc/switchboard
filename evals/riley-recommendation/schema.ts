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
  /** Reduced expected label: an action name, `watch`, or `insight`. */
  expectedOutcome: z.string().min(1),
  notes: z.string().optional(),
});
export type RileyCase = z.infer<typeof RileyCaseSchema>;
