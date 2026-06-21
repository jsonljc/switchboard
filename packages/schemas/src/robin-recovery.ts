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

/**
 * Parameters for a robin.recovery_send.retry intent: identifies the specific RobinRecoverySend row
 * to retry, the contact and booking it covers, and the current attempt count used for backoff
 * computation. The rowId is the row's id (not the dedupeKey) so the retry executor reclaims the
 * existing row rather than creating a new one.
 */
export const RobinRecoveryRetryParamsSchema = z.object({
  rowId: z.string().min(1),
  contactId: z.string().min(1),
  bookingId: z.string().min(1),
  campaignKind: z.string().min(1),
  attempts: z.number().int().nonnegative(),
});
export type RobinRecoveryRetryParams = z.infer<typeof RobinRecoveryRetryParamsSchema>;
