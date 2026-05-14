"use client";

import styles from "../activity.module.css";

export interface ErrorBannerProps {
  path: string;
  method?: string;
  status?: number;
  durationMs?: number;
  /** Whether a previous successful page is rendered below. Drives the trailing copy honesty. */
  hasCachedRows?: boolean;
  onRetry: () => void;
}

export function ErrorBanner({
  path,
  method,
  status,
  durationMs,
  hasCachedRows = false,
  onRetry,
}: ErrorBannerProps) {
  const hasFullTelemetry = method !== undefined && status !== undefined && durationMs !== undefined;
  const head = hasFullTelemetry
    ? `${method} ${path} returned ${status} after ${Math.round(durationMs / 1000)}s.`
    : `Request to ${path} failed.`;
  // Only claim "previous page is still shown" when there actually is one;
  // first-fetch errors should not lie.
  const tail = hasCachedRows
    ? " The previous page of entries is still shown below; nothing was dropped."
    : "";
  const message = head + tail;

  return (
    <div role="alert" className={styles.errBanner}>
      <span className={styles.errBannerEyebrow}>request failed</span>
      <span className={styles.errBannerMsg}>{message}</span>
      <button type="button" className={styles.errBannerRetry} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
