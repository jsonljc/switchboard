"use client";

import styles from "../reports.module.css";

/**
 * Loading placeholder for /reports while live data is in flight (issue #472).
 * Structural only — no data, no copy.
 */
export function ReportsSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading report">
      <div className={styles.skelHero} />
      <div className={styles.skelLine} />
      <div className={styles.skelLine} />
      <div className={styles.skelBlock} />
    </div>
  );
}
