"use client";

import styles from "../reports.module.css";

export interface ReportsUnavailableProps {
  onRetry: () => void;
}

/**
 * Live-mode failure state for /reports (issue #472). Calm, not a stack trace,
 * not a blank page. Never reuses empty-state copy — an error is an error.
 */
export function ReportsUnavailable({ onRetry }: ReportsUnavailableProps) {
  return (
    <div className={styles.unavailable} role="alert">
      <span className={styles.eyebrow}>Temporarily unavailable</span>
      <p className={styles.unavailableMsg}>
        We couldn&apos;t load your report just now. This is usually momentary — your numbers are
        safe. Try again in a moment.
      </p>
      <button type="button" className={styles.retryAction} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
