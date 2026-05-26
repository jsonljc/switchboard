import { fmtSGD, fmtInt } from "@/app/(auth)/(mercury)/reports/components/format";
import type { ResultsModel } from "./results-model";
import { DeltaBadge } from "./delta-badge";
import styles from "./results.module.css";

/** Lean above-the-fold hero: three honest numbers, no derived ratios.
 *  Revenue is largest. Consults is co-hero. Ad spend is visually quiet.
 *  No ROAS, no avg-per-consult — both would fold Alex's no-ad-cost
 *  reactivations into ad-return math (category error). */
export function HeroOutcomes({ model }: { model: ResultsModel }) {
  return (
    <div className={styles.heroOutcomes}>
      {/* Primary: booked revenue */}
      <div className={styles.heroRevenue}>
        <span className={styles.heroRevenueNum}>{fmtSGD(model.attribution.total)}</span>
        <DeltaBadge delta={model.attribution.delta} size="lg" />
        <span className={styles.heroRevenueLabel}>Booked revenue</span>
      </div>

      {/* Co-hero row: consults + ad spend */}
      <div className={styles.heroCoRow}>
        {/* Consults booked */}
        <div className={styles.heroStat}>
          <span className={styles.heroStatNum}>{fmtInt(model.bookings)}</span>
          <DeltaBadge delta={model.bookingsDelta} />
          <span className={styles.heroStatLabel}>Consults booked</span>
        </div>

        {/* Ad spend — quiet / subordinate */}
        <div className={styles.heroAdSpend}>
          <span className={styles.heroAdSpendNum}>{fmtSGD(model.adSpend)}</span>
          <span className={styles.heroAdSpendLabel}>Ad spend</span>
        </div>
      </div>
    </div>
  );
}
