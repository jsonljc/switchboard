import type { FunnelRowData, FunnelNarrative } from "@switchboard/schemas";
import styles from "../reports.module.css";

export function Funnel({ rows, narrative }: { rows: FunnelRowData[]; narrative: FunnelNarrative }) {
  const maxN = Math.max(...rows.map((r) => r.n), 1);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.eyebrow}>Funnel</span>
        <span className={styles.right}>five stages · proportional</span>
      </div>

      <div className={styles.funnel}>
        {rows.map((r, i) => {
          const pct = (r.n / maxN) * 100;
          const dKind = r.delta?.kind ?? "flat";
          return (
            <div className={styles.funnelTable} data-i={i} key={r.stage}>
              <span className={styles.funnelStage}>{r.stage}</span>
              <span className={styles.funnelBar} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${pct.toFixed(2)}%` }} />
              </span>
              <span className={styles.funnelNum}>{r.label}</span>
              <span className={`${styles.funnelDelta} ${styles[dKind]}`}>
                {r.delta ? r.delta.text : "—"}
              </span>
            </div>
          );
        })}

        <div className={styles.funnelByline}>
          <span className={styles.marker}>{narrative.marker}</span>
          <p className={styles.text}>{narrative.text}</p>
        </div>
      </div>
    </section>
  );
}
