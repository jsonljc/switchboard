import { z } from "zod";

/**
 * One no-show recovery target, frozen into the campaign the manager approves. attendeeName is for
 * the approval card only; the recipient phone is resolved at dispatch from contactId (the
 * consent-gated send slice), never frozen here, so consent is re-validated at send time.
 */
export const RecoveryCandidateSchema = z.object({
  bookingId: z.string().min(1),
  contactId: z.string().min(1),
  service: z.string().min(1),
  startsAt: z.string().datetime(),
  attendeeName: z.string().nullable().optional(),
});
export type RecoveryCandidate = z.infer<typeof RecoveryCandidateSchema>;

/**
 * Parameters for a robin.recovery_campaign.send intent: the frozen cohort plus the window it was
 * assembled over. recipientCount is the blast radius surfaced on the approval card and MUST equal
 * the cohort size. A campaign with zero candidates is invalid (it must never park).
 */
export const RobinRecoveryCampaignParamsSchema = z
  .object({
    windowFrom: z.string().datetime(),
    windowTo: z.string().datetime(),
    candidates: z.array(RecoveryCandidateSchema).min(1),
    recipientCount: z.number().int().nonnegative(),
  })
  .refine((p) => p.recipientCount === p.candidates.length, {
    message: "recipientCount must equal the number of candidates",
    path: ["recipientCount"],
  });
export type RobinRecoveryCampaignParams = z.infer<typeof RobinRecoveryCampaignParamsSchema>;
