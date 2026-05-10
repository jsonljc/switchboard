"use client";

import styles from "../activity.module.css";

export interface EmptyStateProps {
  /** "zero" = org has no audit entries; "filtered" = current filter returns no rows. */
  variant: "zero" | "filtered";
  /** Required when variant="filtered". Called when the user clicks [Clear filters]. */
  onClear?: () => void;
}

/**
 * Empty-state views for /activity.
 *
 * Two distinct variants per spec §6.5:
 *
 * zero-state:
 *   "No activity yet."
 *   "The audit ledger records every action, approval, and override."
 *
 * filtered-empty:
 *   "No matching activity."
 *   [Clear filters]
 */
export function EmptyState({ variant, onClear }: EmptyStateProps) {
  if (variant === "zero") {
    return (
      <div className={styles.emptyWrap}>
        <h2 className={styles.emptyTitle}>No activity yet.</h2>
        <p className={styles.emptyBody}>
          The audit ledger records every action, approval, and override.
        </p>
      </div>
    );
  }

  // filtered
  return (
    <div className={styles.emptyWrap}>
      <h2 className={styles.emptyTitle}>No matching activity.</h2>
      {onClear && (
        <button type="button" className={styles.emptyAction} onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}
