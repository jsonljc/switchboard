import type { AttributionData } from "@switchboard/schemas";
import styles from "../reports.module.css";
import { fmtSGD } from "./format";
import { DeltaBadge } from "./delta-badge";

export function Attribution({ data }: { data: AttributionData }) {
  const dollars = Math.round(data.total).toLocaleString("en-SG");
  const rileyShare = data.riley.value / Math.max(1, data.total);
  const alexShare = data.alex.value / Math.max(1, data.total);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.eyebrow}>Revenue we drove</span>
        <span className={styles.right}>total this period</span>
      </div>

      <div className={styles.attrBlock}>
        <div className={styles.attrHero}>
          <div className={`${styles.attrNum} ${styles.fadeIn}`} key={data.total}>
            <span className={styles.sgd}>S$</span>
            {dollars}
          </div>
          <div className={styles.attrAside}>
            <span className={styles.label}>vs. previous period</span>
            <DeltaBadge delta={data.delta} />
            <p className={styles.desc}>
              Pipeline value attributed by closed bookings, weighted by service price at the point
              of sale.
            </p>
          </div>
        </div>

        <div className={styles.attrSplit}>
          <div className={`${styles.attrCard} ${styles.riley}`}>
            <div className={styles.who}>
              <span className={styles.whoGlyph}>R</span>
              <span className={styles.whoName}>Riley</span>
              <span className={styles.whoRole}>Ad-ops</span>
            </div>
            <div className={`${styles.val} ${styles.fadeIn}`} key={data.riley.value}>
              {fmtSGD(data.riley.value, { withCents: "never" })}
            </div>
            <div className={styles.cap}>{data.riley.caption}</div>
            <div className={styles.shareLine}>
              <div className={styles.shareBar}>
                <span style={{ width: `${(rileyShare * 100).toFixed(1)}%` }} />
              </div>
              <span className={styles.sharePct}>{Math.round(rileyShare * 100)}%</span>
            </div>
          </div>
          <div className={`${styles.attrCard} ${styles.alex}`}>
            <div className={styles.who}>
              <span className={styles.whoGlyph}>A</span>
              <span className={styles.whoName}>Alex</span>
              <span className={styles.whoRole}>Conversations</span>
            </div>
            <div className={`${styles.val} ${styles.fadeIn}`} key={data.alex.value}>
              {fmtSGD(data.alex.value, { withCents: "never" })}
            </div>
            <div className={styles.cap}>{data.alex.caption}</div>
            <div className={styles.shareLine}>
              <div className={styles.shareBar}>
                <span style={{ width: `${(alexShare * 100).toFixed(1)}%` }} />
              </div>
              <span className={styles.sharePct}>{Math.round(alexShare * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
