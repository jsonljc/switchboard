import type { ResultsModel } from "./results-model";
import { fmtSGD, fmtInt } from "@/app/(auth)/(mercury)/reports/components/format";
import styles from "./results.module.css";

/** Weekly receipted-booking REVENUE. Two dimensions over one cohort: the headline is PROVEN PAID
 *  revenue (the north star's final, highest-value link, summed from verified payment receipts), with
 *  paid coverage ("N of M bookings paid"); the quieter secondary line keeps the EXPECTED/booked value
 *  (the stable expectedValueAtIssue snapshot, else the live Opportunity value) as pipeline context, so
 *  the owner sees both what was booked and what has actually been collected.
 *
 *  Paid is GROSS verified-paid (no refund/void receipt path today), not net of refunds. Money renders
 *  via the report's single-currency `fmtSGD`; *Cents fields are CENTS, so divide by 100 for fmtSGD's
 *  whole-dollar input. An empty cohort shows a quiet prose line, matching the other no-data tiles. */
export function ReceiptedBookingRevenueTile({ model }: { model: ResultsModel }) {
  const { revenueCents, bookingsWithValue, cohortSize, paidRevenueCents, paidBookings } =
    model.receiptedBookingRevenue;

  if (cohortSize === 0) {
    return (
      <div className={styles.proofRevenue}>
        <p className={styles.proofQualityEyebrow}>Receipted revenue</p>
        <p className={styles.proofQualityEmpty}>No receipted bookings this period.</p>
      </div>
    );
  }

  return (
    <div className={styles.proofRevenue}>
      <p className={styles.proofQualityEyebrow}>Receipted revenue</p>
      <p className={styles.proofRevenueAmount}>{fmtSGD(paidRevenueCents / 100)}</p>
      <p className={styles.proofRevenueCoverage}>
        {fmtInt(paidBookings)} of {fmtInt(cohortSize)} bookings paid
      </p>
      <p className={styles.proofRevenueSecondary}>
        Booked {fmtSGD(revenueCents / 100)} · {fmtInt(bookingsWithValue)} of {fmtInt(cohortSize)}{" "}
        valued
      </p>
    </div>
  );
}
