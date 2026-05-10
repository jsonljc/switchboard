"use client";

import styles from "../contacts.module.css";

export type EmptyVariant = "loading" | "zero" | "filtered" | "error";

export interface EmptyStateProps {
  variant: EmptyVariant;
  onClear?: () => void;
  onRetry?: () => void;
}

const SKELETON_ROW_COUNT = 8;

export function EmptyState({ variant, onClear, onRetry }: EmptyStateProps) {
  if (variant === "loading") {
    return (
      <div className={styles.skeletonTable} role="status" aria-label="Loading contacts">
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, idx) => (
          <div key={idx} className={styles.skeletonRow} aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (variant === "zero") {
    return (
      <div className={styles.emptyWrap}>
        <h2 className={styles.emptyTitle}>No contacts yet.</h2>
        <p className={styles.emptyBody}>They&rsquo;ll appear here as conversations come in.</p>
      </div>
    );
  }

  if (variant === "filtered") {
    return (
      <div className={styles.emptyWrap}>
        <h2 className={styles.emptyTitle}>No matches.</h2>
        <p className={styles.emptyBody}>Try a different search or clear your filter.</p>
        {onClear && (
          <button type="button" className={styles.emptyAction} onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    );
  }

  // error
  return (
    <div className={styles.emptyWrap} role="alert">
      <h2 className={styles.emptyTitle}>Couldn&rsquo;t load contacts.</h2>
      {onRetry && (
        <button type="button" className={styles.emptyAction} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
