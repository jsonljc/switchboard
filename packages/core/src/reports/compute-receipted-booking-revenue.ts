import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type { ReceiptedBookingRevenueData } from "@switchboard/schemas";

/**
 * Weekly receipted-booking REVENUE for the owner report (north star: count -> proven booked revenue).
 * Consumes the SAME `listForCohort` projection as the count/quality dimensions, so the cohort never
 * disagrees. Hybrid population (spec section 4): a booking with a persisted issuance row (issuedAt
 * present) contributes its STABLE snapshot `expectedValueAtIssue` (a null snapshot contributes 0 and
 * never falls back to live); a pre-hook booking with no persisted row falls back to the live
 * Opportunity value so historical bookings are not silently zero (no backfill, no inert period).
 *
 * Two dimensions over the one cohort: EXPECTED (the booked pipeline, above) and PROVEN-PAID. The
 * paid dimension sums each view's `paidValueCents` (the store derives it via the pure isPaidVisit
 * verdict over the booking's verified payment receipts) and counts `paid` members. Both NaN-safe:
 * only finite, nonnegative terms sum, so neither figure renders NaN. paidRevenueCents is GROSS
 * verified-paid (no refund/void receipt path today), not net of refunds.
 */
export async function computeReceiptedBookingRevenue(
  ctx: RollupContext,
  receiptedBookings: ReportStores["receiptedBookings"],
): Promise<ReceiptedBookingRevenueData> {
  const views = await receiptedBookings.listForCohort({
    orgId: ctx.orgId,
    from: ctx.current.start,
    to: ctx.current.end,
  });

  let revenueCents = 0;
  let bookingsWithValue = 0;
  let currency: string | null = null;
  let paidRevenueCents = 0;
  let paidBookings = 0;

  for (const v of views) {
    // issuedAt presence is the discriminator: a persisted row uses its stable snapshot (even when
    // null); only a row-less historical booking falls back to the live Opportunity value.
    const persisted = v.issuedAt != null;
    const raw = persisted ? (v.expectedValueAtIssue ?? null) : v.expectedValue;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      revenueCents += raw;
      bookingsWithValue += 1;
    }
    if (currency == null && v.currency != null) currency = v.currency;

    // Proven-paid dimension. `paid` is the count signal; `paidValueCents` the money sum, guarded the
    // same way as the expected sum so a null (not-paid) or non-finite amount never poisons the total.
    if (v.paid) paidBookings += 1;
    const paidRaw = v.paidValueCents;
    if (typeof paidRaw === "number" && Number.isFinite(paidRaw) && paidRaw >= 0) {
      paidRevenueCents += paidRaw;
    }
  }

  return {
    revenueCents,
    currency,
    bookingsWithValue,
    cohortSize: views.length,
    paidRevenueCents,
    paidBookings,
  };
}
