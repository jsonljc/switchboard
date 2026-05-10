"use client";

import styles from "../automations.module.css";

type Kind = "zero" | "filtered" | "error";

interface Props {
  kind: Kind;
  onClearFilter?: () => void;
  onRetry?: () => void;
}

export function EmptyState({ kind, onClearFilter, onRetry }: Props) {
  if (kind === "zero") {
    return (
      <div className={styles.emptyState}>
        <p>No automations yet. Triggers scheduled by your agents will appear here.</p>
      </div>
    );
  }
  if (kind === "filtered") {
    return (
      <div className={styles.emptyState}>
        <p>No matches. Try a different filter.</p>
        <button type="button" onClick={onClearFilter} className={styles.linkButton}>
          Clear
        </button>
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      <p>Couldn&rsquo;t load automations.</p>
      <button type="button" onClick={onRetry} className={styles.linkButton}>
        Try again
      </button>
    </div>
  );
}
