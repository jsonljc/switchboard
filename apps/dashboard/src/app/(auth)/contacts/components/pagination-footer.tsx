"use client";

import styles from "../contacts.module.css";

export interface PaginationFooterProps {
  rowsLoaded: number;
  hasMore: boolean;
  onLoadMore: () => void;
  isFetchingMore: boolean;
}

export function PaginationFooter({
  rowsLoaded,
  hasMore,
  onLoadMore,
  isFetchingMore,
}: PaginationFooterProps) {
  if (rowsLoaded === 0) return null;

  return (
    <div className={styles.paginationFooter}>
      {hasMore ? (
        <>
          <span className={styles.count}>Showing 1–{rowsLoaded}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className={styles.moreButton}
            onClick={onLoadMore}
            disabled={isFetchingMore}
          >
            {isFetchingMore ? "Loading…" : "more"}
            <span className={styles.arr} aria-hidden="true">
              →
            </span>
          </button>
        </>
      ) : (
        <span className={styles.count}>Showing {rowsLoaded} total</span>
      )}
    </div>
  );
}
