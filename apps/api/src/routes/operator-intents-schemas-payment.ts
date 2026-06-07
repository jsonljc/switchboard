import { z } from "zod";

/**
 * Parameters for the `payment.record_verified` intent. Authority is the external
 * PSP fetch-back; `amountCents` is the RE-FETCHED amount in minor units, never a
 * webhook-body value. `externalReference` is required — it is the replay key
 * (partial unique in the DB). `provider` selects the evidence tier (R1): a real
 * PSP -> T1 verified; 'noop' -> T3 degraded, never production-countable.
 */
export const RecordVerifiedPaymentParametersSchema = z.object({
  contactId: z.string().min(1),
  opportunityId: z.string().min(1),
  bookingId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default("SGD"),
  externalReference: z.string().min(1),
  provider: z.string().min(1).default("noop"),
  connectionId: z.string().min(1).optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

export type RecordVerifiedPaymentParameters = z.infer<typeof RecordVerifiedPaymentParametersSchema>;
