"use client";

import styles from "../automations.module.css";

interface Props {
  shownCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  loading: boolean;
}

export function PaginationFooter({ shownCount, hasMore, onLoadMore, loading }: Props) {
  return (
    <div className={styles.paginationFooter}>
      <span className={styles.mono}>
        Showing 1–{shownCount}
        {hasMore ? " · " : ""}
      </span>
      {hasMore ? (
        <button type="button" className={styles.moreButton} onClick={onLoadMore} disabled={loading}>
          {loading ? "Loading…" : "more →"}
        </button>
      ) : null}
    </div>
  );
}
