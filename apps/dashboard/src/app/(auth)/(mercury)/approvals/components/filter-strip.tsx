"use client";

import styles from "../approvals.module.css";

export type RiskFilter = "all" | "low" | "medium" | "high" | "critical";

export interface FilterStripProps {
  filter: RiskFilter;
  expiringOnly: boolean;
  counts: Record<RiskFilter, number>;
  expiringSoonCount: number;
  onChange: (next: { filter: RiskFilter; expiringOnly: boolean }) => void;
}

const RISKS: ReadonlyArray<Exclude<RiskFilter, "all">> = ["low", "medium", "high", "critical"];

export function FilterStrip({
  filter,
  expiringOnly,
  counts,
  expiringSoonCount,
  onChange,
}: FilterStripProps) {
  return (
    <div className={styles.filterStrip}>
      <span className={styles.eyebrow}>filter</span>
      <button
        type="button"
        className={`${styles.filterChip} ${filter === "all" ? styles.filterChipOn : ""}`}
        onClick={() => onChange({ filter: "all", expiringOnly })}
      >
        all <span className={styles.filterChipCount}>{counts.all}</span>
      </button>
      {RISKS.map((r) => (
        <button
          key={r}
          type="button"
          data-cat={r}
          className={`${styles.filterChip} ${filter === r ? styles.filterChipOn : ""}`}
          onClick={() => onChange({ filter: r, expiringOnly })}
        >
          <span className={styles.filterChipBullet} aria-hidden="true" />
          {r} <span className={styles.filterChipCount}>{counts[r] ?? 0}</span>
        </button>
      ))}
      <button
        type="button"
        className={`${styles.filterChip} ${expiringOnly ? styles.filterChipOn : ""}`}
        onClick={() => onChange({ filter, expiringOnly: !expiringOnly })}
      >
        expiring &lt; 60m <span className={styles.filterChipCount}>{expiringSoonCount}</span>
      </button>
    </div>
  );
}
