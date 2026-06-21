import type { ResultsModel } from "./results-model";
import { fmtInt, fmtPct } from "@/components/reports-shared/format";
import styles from "./results.module.css";

/** Held-appointment rate: of the consults that matured in this window, how many
 *  were attended. fmtPct already renders null as an em-dash, so a 0-matured
 *  period (rate null) shows "—" rather than NaN or a misleading 0%. */
export function HeldRateTile({ model }: { model: ResultsModel }) {
  const { attended, matured, rate } = model.heldRate;

  return (
    <div className={styles.heldRate}>
      <p className={styles.heldRateEyebrow}>Held-appointment rate</p>
      <p className={styles.heldRateNum}>{fmtPct(rate, 2)}</p>
      <p className={styles.heldRateCohort}>
        {fmtInt(attended)} of {fmtInt(matured)} matured consults attended
      </p>
    </div>
  );
}
