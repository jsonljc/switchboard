import type { ResultsModel } from "./results-model";
import { fmtInt } from "@/app/(auth)/(mercury)/reports/components/format";
import styles from "./results.module.css";

/** Receipted bookings: how many bookings produced a proof receipt in this window. A
 *  calendar receipt is minted at booking time, so this is the count of non-void calendar
 *  receipts created in the period. A zero-count window shows "—" rather than a hollow 0,
 *  matching the held-rate / consent tiles' no-data rendering. */
export function ReceiptedBookingsTile({ model }: { model: ResultsModel }) {
  const { count } = model.receiptedBookings;

  return (
    <div className={styles.receiptedBookings}>
      <p className={styles.receiptedBookingsEyebrow}>Receipted bookings</p>
      <p className={styles.receiptedBookingsNum}>{count > 0 ? fmtInt(count) : "—"}</p>
      <p className={styles.receiptedBookingsCohort}>bookings with a proof receipt this period</p>
    </div>
  );
}
