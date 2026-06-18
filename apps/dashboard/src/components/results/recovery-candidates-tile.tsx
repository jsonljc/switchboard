import type { ResultsModel } from "./results-model";
import { fmtInt } from "@/app/(auth)/(mercury)/reports/components/format";
import styles from "./results.module.css";

/** No-show recovery candidates: count of appointments recorded as no-show in this window.
 *  v1 renders the raw count honestly. Zero shows "0" (not an em-dash) because zero no-shows
 *  is a genuinely good outcome, not a data-missing state. The "exclude already-rebooked"
 *  refinement is deferred to the campaign-assembly slice. */
export function RecoveryCandidatesTile({ model }: { model: ResultsModel }) {
  const { noShows } = model.recoveryCandidates;

  return (
    <div className={styles.recoveryCandidates}>
      <p className={styles.recoveryCandidatesEyebrow}>No-show appointments</p>
      <p className={styles.recoveryCandidatesNum}>{fmtInt(noShows)}</p>
      <p className={styles.recoveryCandidatesNote}>appointments recorded as no-show this period</p>
    </div>
  );
}
