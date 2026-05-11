"use client";

import styles from "../activity.module.css";

export interface PaginationFooterProps {
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Cursor-based prev/next pagination footer for /activity.
 *
 * The page-level component (activity-page.tsx) owns the prevCursorStack and
 * current cursor. This component is purely presentational.
 *
 * Hidden entirely when neither canGoPrev nor canGoNext (single page case).
 */
export function PaginationFooter({ canGoPrev, canGoNext, onPrev, onNext }: PaginationFooterProps) {
  if (!canGoPrev && !canGoNext) return null;

  return (
    <div className={styles.paginationFooter}>
      <button
        type="button"
        className={styles.moreButton}
        onClick={onPrev}
        disabled={!canGoPrev}
        aria-label="Previous page"
      >
        <span className={styles.arr} aria-hidden="true">
          ←
        </span>
        {" Prev"}
      </button>

      <button
        type="button"
        className={styles.moreButton}
        onClick={onNext}
        disabled={!canGoNext}
        aria-label="Next page"
      >
        {"Next "}
        <span className={styles.arr} aria-hidden="true">
          →
        </span>
      </button>
    </div>
  );
}
