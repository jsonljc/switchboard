import type { CostBreakdown } from "../fixtures";
import { fmtMoney } from "./format";
import styles from "../reports.module.css";

interface CostVsValueProps {
  cost: CostBreakdown;
  narrative: string;
}

export function CostVsValue({ cost, narrative }: CostVsValueProps) {
  return (
    <>
      <div className={styles.folio}>
        <span className={styles.folioL}>What this would cost otherwise</span>
        <span className={styles.folioR} />
      </div>
      <div className={styles.costRow}>
        <div className={styles.costCell}>
          <span className={`${styles.costNum} ${styles.fadeIn}`} key={cost.paid}>
            {fmtMoney(cost.paid, { cents: true })}/month
          </span>
          <span className={styles.costSub}>what you pay</span>
        </div>
        <div className={styles.costCell}>
          <span className={`${styles.costNum} ${styles.fadeIn}`} key={cost.alt}>
            {fmtMoney(cost.alt)}/month
          </span>
          <span className={styles.costSub}>SDR + ad agency</span>
        </div>
        <div className={styles.costCell}>
          <span
            className={`${styles.costNum} ${styles.isAccent} ${styles.fadeIn}`}
            key={cost.saving}
          >
            Saving {fmtMoney(cost.saving)}/month
          </span>
          <span className={styles.costSub}>every month</span>
        </div>
      </div>
      <p className={styles.costNarrative}>{narrative}</p>
    </>
  );
}
