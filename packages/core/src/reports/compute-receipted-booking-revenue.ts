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
 * NaN-safe: only finite, nonnegative terms sum, so revenueCents never renders NaN.
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
  }

  return { revenueCents, currency, bookingsWithValue, cohortSize: views.length };
}
