"use client";

import styles from "../activity.module.css";

export interface ErrorBannerProps {
  path: string;
  method?: string;
  status?: number;
  durationMs?: number;
  onRetry: () => void;
}

export function ErrorBanner({ path, method, status, durationMs, onRetry }: ErrorBannerProps) {
  const hasFullTelemetry = method !== undefined && status !== undefined && durationMs !== undefined;
  const message = hasFullTelemetry
    ? `${method} ${path} returned ${status} after ${Math.round(durationMs / 1000)}s. The previous page of entries is still shown below; nothing was dropped.`
    : `Request to ${path} failed. The previous page of entries is still shown below; nothing was dropped.`;

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
