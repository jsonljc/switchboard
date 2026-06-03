"use client";

import styles from "./results.module.css";

/** Calm informational banner shown when no Meta Ads connection is detected.
 *  Notes that campaigns/funnel will be empty but Alex reactivation revenue
 *  still appears in the hero numbers. */
export function MetaConnectBanner() {
  return (
    <aside className={styles.stateBanner} role="note">
      <p className={styles.stateBannerTitle}>No Meta Ads connection</p>
      <p className={styles.stateBannerBody}>
        Campaigns and funnel data will be empty until you connect Meta Ads. Revenue from Alex&apos;s
        reactivations still shows in your totals.
      </p>
      <a href="/settings" className={styles.stateBannerCta}>
        Connect under Settings
      </a>
    </aside>
  );
}

/** Calm error banner. Uses the real {@link cacheAgeMinutes} prop — never a
 *  hardcoded number. Offers an onRetry callback. */
export function ErrorBanner({
  cacheAgeMinutes,
  onRetry,
}: {
  cacheAgeMinutes: number;
  onRetry: () => void;
}) {
  return (
    <aside className={styles.stateBanner} role="note">
      <p className={styles.stateBannerTitle}>We couldn&apos;t reach your data stores</p>
      <p className={styles.stateBannerBody}>
        Showing the last cached pull from {cacheAgeMinutes} minutes ago. Numbers may not reflect the
        latest activity.
      </p>
      <button type="button" className={styles.stateBannerCta} onClick={onRetry}>
        Try again
      </button>
    </aside>
  );
}

/** Warm first-run note shown when no data has been generated yet.
 *  Not failure-framed — reassures that agents are running. */
export function FirstRunNote() {
  return (
    <aside className={styles.stateFirstRun} role="note">
      <p className={styles.stateFirstRunTitle}>
        Your first results land here once your team books a consult.
      </p>
      <p className={styles.stateFirstRunBody}>
        Riley and Alex are already running. Check back after your next booking comes in.
      </p>
    </aside>
  );
}

/** Block-placeholder skeleton for the Results screen while data loads.
 *  Uses a {@code role="status"} wrapper so screen readers announce loading state.
 *  No spinner — warm editorial register uses block shapes. */
export function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Loading results" className={styles.skeleton}>
      {/* Hero block */}
      <div className={styles.skeletonHero}>
        <div className={styles.skeletonBlock} style={{ width: "55%", height: "3.5rem" }} />
        <div className={styles.skeletonBlock} style={{ width: "30%", height: "1.25rem" }} />
      </div>
      {/* Card row */}
      <div className={styles.skeletonCardRow}>
        <div className={styles.skeletonCard} />
        <div className={styles.skeletonCard} />
        <div className={styles.skeletonCard} />
      </div>
      {/* Prose block */}
      <div className={styles.skeletonBlock} style={{ width: "100%", height: "4rem" }} />
    </div>
  );
}
