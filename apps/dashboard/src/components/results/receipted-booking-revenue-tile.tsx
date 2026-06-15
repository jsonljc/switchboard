import type { ResultsModel } from "./results-model";
import { fmtSGD, fmtInt } from "@/app/(auth)/(mercury)/reports/components/format";
import styles from "./results.module.css";

/** Weekly receipted-booking REVENUE: the sum of per-booking expected value over the cohort (the stable
 *  expectedValueAtIssue snapshot when a persisted issuance row exists, the live Opportunity value as the
 *  pre-hook fallback). Advances the north star from count to proven booked revenue, and shows coverage
 *  (how many of the cohort carried a value) so the proof is honest rather than a bare figure.
 *
 *  Money renders via the report's single-currency `fmtSGD` (the whole report is SGD; the per-row
 *  `currency` snapshot is captured in the data model for audit/future multi-currency, not re-displayed
 *  here). revenueCents is CENTS, so divide by 100 for fmtSGD's whole-dollar input. An empty cohort
 *  shows a quiet prose line, matching the restraint of the other no-data tiles. */
export function ReceiptedBookingRevenueTile({ model }: { model: ResultsModel }) {
  const { revenueCents, bookingsWithValue, cohortSize } = model.receiptedBookingRevenue;

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
      <p className={styles.proofRevenueAmount}>{fmtSGD(revenueCents / 100)}</p>
      <p className={styles.proofRevenueCoverage}>
        {fmtInt(bookingsWithValue)} of {fmtInt(cohortSize)} bookings valued
      </p>
    </div>
  );
}
