import type { ResultsModel } from "./results-model";
import type { AttributionConfidence, ExceptionCode } from "./types";
import { fmtInt } from "@/app/(auth)/(mercury)/reports/components/format";
import styles from "./results.module.css";

/** Confidence rungs in strongest-to-weakest order. Every rung is shown even at 0: a zero in a
 *  rung is meaningful (zero unattributed is good news), unlike a zero exception which is just absent. */
const CONFIDENCE_RUNGS: ReadonlyArray<{ key: AttributionConfidence; label: string }> = [
  { key: "deterministic", label: "Deterministic" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
  { key: "unattributed", label: "Unattributed" },
];

/** Worklist order: the evidence gaps a medspa owner can act on first. Only nonzero codes render. */
const EXCEPTION_LABELS: ReadonlyArray<{ key: ExceptionCode; label: string }> = [
  { key: "missing_consent", label: "Missing consent" },
  { key: "missing_source", label: "Missing source" },
  { key: "duplicate_contact_risk", label: "Duplicate contact" },
  { key: "manual_override", label: "Manual override" },
];

/** Proof-quality breakdown of the receipted-booking cohort: how attributable each booking is
 *  (deterministic..unattributed) and which bookings still need proof evidence (the worklist).
 *  Consumes the slice-4 read-projection via ReportDataV1.receiptedBookingQuality. An empty cohort
 *  shows a quiet prose line, matching the restraint of the other no-data tiles. */
export function ReceiptedBookingQualityTile({ model }: { model: ResultsModel }) {
  const { cohortSize, confidence, exceptions, bookingsNeedingAttention } =
    model.receiptedBookingQuality;

  if (cohortSize === 0) {
    return (
      <div className={styles.proofQuality}>
        <p className={styles.proofQualityEyebrow}>Proof quality</p>
        <p className={styles.proofQualityEmpty}>No receipted bookings to analyze this period.</p>
      </div>
    );
  }

  const stronglyAttributed = confidence.deterministic + confidence.high;
  const activeExceptions = EXCEPTION_LABELS.filter(({ key }) => exceptions[key] > 0);

  return (
    <div className={styles.proofQuality}>
      <p className={styles.proofQualityEyebrow}>Proof quality</p>
      <p className={styles.proofQualityLead}>
        {fmtInt(stronglyAttributed)} of {fmtInt(cohortSize)} strongly attributed
      </p>

      <ul className={styles.proofQualityRungs}>
        {CONFIDENCE_RUNGS.map(({ key, label }) => {
          const n = confidence[key];
          const pct = Math.round((n / cohortSize) * 100);
          return (
            <li key={key} className={styles.proofQualityRung}>
              <span className={styles.proofQualityRungLabel}>{label}</span>
              <span className={styles.proofQualityRungTrack}>
                <span
                  className={styles.proofQualityRungBar}
                  style={{ width: `${pct}%` }}
                  data-empty={n === 0 ? "true" : undefined}
                />
              </span>
              <span className={styles.proofQualityRungNum}>{fmtInt(n)}</span>
            </li>
          );
        })}
      </ul>

      {bookingsNeedingAttention === 0 ? (
        <p className={styles.proofQualityClear}>
          Every receipted booking has complete proof evidence.
        </p>
      ) : (
        <div className={styles.proofQualityWorklist}>
          <p className={styles.proofQualityWorklistHead}>
            {fmtInt(bookingsNeedingAttention)} need attention
          </p>
          <ul className={styles.proofQualityExceptions}>
            {activeExceptions.map(({ key, label }) => (
              <li key={key} className={styles.proofQualityException}>
                <span className={styles.proofQualityExceptionNum}>{fmtInt(exceptions[key])}</span>
                <span className={styles.proofQualityExceptionLabel}>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
