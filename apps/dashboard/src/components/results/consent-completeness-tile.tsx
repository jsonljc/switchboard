import type { ResultsModel } from "./results-model";
import { fmtInt, fmtPct } from "@/app/(auth)/(mercury)/reports/components/format";
import styles from "./results.module.css";

/** Consent completeness: of the contacts that PDPA applies to (jurisdiction-tagged),
 *  how many have valid consent on file right now. This is a CURRENT, all-contacts
 *  snapshot — not the report window — so the copy stays present-tense with no
 *  "this period" qualifier. fmtPct renders null as an em-dash, so a clinic with no
 *  PDPA-applicable contacts (rate null) shows "—" rather than NaN or a hollow 0%. */
export function ConsentCompletenessTile({ model }: { model: ResultsModel }) {
  const { validConsent, bookable, rate } = model.consentCompleteness;

  return (
    <div className={styles.consentCompleteness}>
      <p className={styles.consentCompletenessEyebrow}>Consent on file</p>
      <p className={styles.consentCompletenessNum}>{fmtPct(rate, 2)}</p>
      <p className={styles.consentCompletenessCohort}>
        {fmtInt(validConsent)} of {fmtInt(bookable)} contacts have consent on file
      </p>
    </div>
  );
}
