"use client";

import styles from "../approvals.module.css";

export interface ApprovalsHeaderProps {
  pendingCount: number;
  expiringSoonCount: number;
}

export function ApprovalsHeader({ pendingCount, expiringSoonCount }: ApprovalsHeaderProps) {
  return (
    <header className={styles.pageHead}>
      <div className={styles.lead}>
        <span className={styles.eyebrow}>Approvals queue</span>
        <h1 className={styles.pageTitle}>Approvals</h1>
        <p className={styles.pageSub}>
          Every agent-proposed action waits here until you say yes. Each card carries a confirmation
          code that locks in the details — approve only when the details match what you want.
        </p>
      </div>
      <div className={styles.pageMeta}>
        <div className={styles.statTile}>
          <span className={styles.eyebrow}>pending</span>
          <span className={styles.statValue}>{pendingCount}</span>
        </div>
        <div className={`${styles.statTile} ${styles.statTileAccent}`}>
          <span className={styles.eyebrow}>&lt; 1h to expiry</span>
          <span className={styles.statValue}>{expiringSoonCount}</span>
        </div>
      </div>
    </header>
  );
}
