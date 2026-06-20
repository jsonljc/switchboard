import type { Receipt } from "@switchboard/schemas";
import { isPaidVisit } from "./is-paid-visit.js";

/**
 * The minimal payment-receipt projection the paid-value derivation needs: exactly what `isPaidVisit`
 * reads ({kind, status, provider, tier}) plus the `amount` to sum. A full `Receipt` satisfies it, so
 * callers can pass either a Prisma read projection or a full Receipt.
 */
export type PaidReceiptProjection = Pick<
  Receipt,
  "kind" | "status" | "provider" | "tier" | "amount"
>;

/**
 * GROSS verified-paid value for one booking, derived from its receipts.
 * - `paid` is true when the booking has at least one production-countable verified-paid receipt
 *   (`isPaidVisit().paid`, which is true ONLY for a real provider + T1 fetch-back + status "paid";
 *   a noop/degraded payment and any calendar receipt return paid=false and are excluded).
 * - `paidValueCents` sums the `amount` (cents) of those paid receipts. NaN-safe: only finite,
 *   nonnegative amounts contribute, so it never renders NaN. It is `null` when the booking is not
 *   paid, and `0` when paid but no finite amount is known.
 *
 * This is GROSS verified-paid (the R2 proof primitive). No refund/void receipt-write path exists
 * today, so it is NOT net of refunds or chargebacks (refund/payout reconciliation is deferred).
 */
export interface BookingPaidValue {
  paid: boolean;
  paidValueCents: number | null;
}

export function computeBookingPaidValue(receipts: PaidReceiptProjection[]): BookingPaidValue {
  let paid = false;
  let sum = 0;
  for (const receipt of receipts) {
    if (!isPaidVisit(receipt).paid) continue;
    paid = true;
    const { amount } = receipt;
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
      sum += amount;
    }
  }
  return { paid, paidValueCents: paid ? sum : null };
}
