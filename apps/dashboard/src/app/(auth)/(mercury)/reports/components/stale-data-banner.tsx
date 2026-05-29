"use client";

import styles from "../reports.module.css";

export interface StaleDataBannerProps {
  cacheAge: number | null;
  onRetry: () => void;
}

/**
 * Shown when live /reports has cached data but the latest refresh failed
 * (issue #472). The report below remains visible; this banner is honest that
 * it may be stale and offers a retry.
 */
export function StaleDataBanner({ cacheAge, onRetry }: StaleDataBannerProps) {
  const ageLabel = cacheAge != null && cacheAge > 0 ? `${cacheAge} min ago` : "moments ago";
  return (
    <div className={styles.bannerStale} role="status">
      <span className={styles.eyebrow}>Couldn&apos;t refresh</span>
      <span className={styles.msg}>
        Showing the version we loaded {ageLabel}. We&apos;ll pick up the latest once the connection
        recovers.
      </span>
      <button type="button" className={styles.cta} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
