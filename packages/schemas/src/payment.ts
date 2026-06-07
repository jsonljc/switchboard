import { z } from "zod";

/**
 * PSP payment lifecycle status. DISTINCT from the Receipt status enum
 * (booked|held|paid|void) introduced in PR 1A-3 — this is the raw provider
 * charge state, not the structured visit verdict.
 */
export const PaymentStatusSchema = z.enum(["pending", "paid", "failed", "refunded"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * Input to PaymentPort.createDepositLink. The deposit is keyed to an already
 * confirmed booking; amount flows as minor units (cents) end-to-end (spec §11).
 */
export const DepositLinkInputSchema = z.object({
  bookingId: z.string().min(1),
  organizationId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
});
export type DepositLinkInput = z.infer<typeof DepositLinkInputSchema>;

/**
 * A first-party deposit link issued for a confirmed booking. `externalReference`
 * is the PSP-side handle the webhook (PR 1A-4) re-fetches the charge by — for the
 * Noop adapter it is the DETERMINISTIC `noop_pay_${bookingId}`.
 */
export const DepositLinkSchema = z.object({
  url: z.string().min(1),
  externalReference: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
});
export type DepositLink = z.infer<typeof DepositLinkSchema>;

/**
 * The result of re-fetching a charge by its external reference. The verified
 * writer (PR 1A-4) trusts THIS object's amount, never a webhook body. A payment
 * whose `provider` is 'noop' is DEGRADED and must never be counted as a real
 * (T1) production paid visit (spec §3, R1).
 *
 * `bookingId` is the PSP-metadata-recovered booking linkage (populated from
 * PaymentIntent.metadata.bookingId on Stripe, or from the deterministic
 * `noop_pay_${bookingId}` prefix on Noop). Null when the PSP metadata does not
 * carry a booking reference — the webhook route 200-skips such charges rather
 * than emitting a partial record or a ZodError 500.
 */
export const VerifiedPaymentSchema = z.object({
  provider: z.string().min(1),
  externalReference: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  status: PaymentStatusSchema,
  bookingId: z.string().nullable(),
});
export type VerifiedPayment = z.infer<typeof VerifiedPaymentSchema>;

/**
 * No-PMS payment seam (architecture A). Mirrors `CalendarProvider`
 * (calendar.ts). EXACTLY two methods — link issuance and a fetch-back read.
 * Concrete adapters (Noop now, Stripe Connect in PR 1A-4b) live in apps/api;
 * orchestration + the PSP webhook live in apps/api, never in this layer.
 */
export interface PaymentPort {
  createDepositLink(input: DepositLinkInput): Promise<DepositLink>;
  retrievePayment(externalReference: string): Promise<VerifiedPayment | null>;
}
