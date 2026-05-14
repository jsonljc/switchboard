"use client";

import styles from "../activity.module.css";

export interface PaginationFooterProps {
  count: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function PaginationFooter({
  count,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}: PaginationFooterProps) {
  if (!canGoPrev && !canGoNext) return null;

  return (
    <div className={styles.pag}>
      <span className={styles.pagInfo}>
        Showing <b className={styles.pagInfoB}>{count}</b> of <b className={styles.pagInfoB}>…</b>
        <span className={styles.pagInfoSep}>·</span>
        keyset cursor — total unknown by design
        <span className={styles.pagInfoSep}>·</span>
        limit <b className={styles.pagInfoB}>50</b>
      </span>
      <div className={styles.pagNav}>
        <button
          type="button"
          className={styles.pagBtn}
          onClick={onPrev}
          disabled={!canGoPrev}
          aria-label="Newer page"
        >
          ← Newer
        </button>
        <button
          type="button"
          className={styles.pagBtn}
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="Older page"
        >
          Older →
        </button>
      </div>
    </div>
  );
}
