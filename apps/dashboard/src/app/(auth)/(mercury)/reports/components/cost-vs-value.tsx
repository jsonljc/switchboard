import type { CostBreakdown } from "@switchboard/schemas";
import styles from "../reports.module.css";
import { fmtSGD } from "./format";

export function CostVsValue({ cost, narrative }: { cost: CostBreakdown; narrative: string }) {
  const savingDollars = Math.round(cost.saving).toLocaleString("en-SG");

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.eyebrow}>Cost vs. value</span>
        <span className={styles.right}>the renewal arithmetic</span>
      </div>

      <div className={styles.costBlock}>
        <div className={styles.costThree}>
          <div className={`${styles.costCell} ${styles.paid}`}>
            <span className={styles.label}>You pay</span>
            <span className={styles.v}>{fmtSGD(cost.paid)}</span>
            <span className={styles.sub}>Switchboard subscription, this period</span>
          </div>
          <div className={`${styles.costCell} ${styles.alt}`}>
            <span className={styles.label}>Salesperson + ad agency</span>
            <span className={styles.v}>{fmtSGD(cost.alt, { withCents: "never" })}</span>
            <span className={styles.sub}>market-rate equivalent</span>
          </div>
          <div className={`${styles.costCell} ${styles.saving}`}>
            <span className={styles.label}>Monthly saving</span>
            <span className={styles.v}>
              <span className={styles.sgd}>S$</span>
              {savingDollars}
            </span>
            <span className={styles.sub}>net to your P&amp;L</span>
          </div>
        </div>
        <p className={styles.costNarrative}>{narrative}</p>
      </div>
    </section>
  );
}
