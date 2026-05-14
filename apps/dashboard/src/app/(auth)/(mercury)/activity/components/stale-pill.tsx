"use client";

import { useEffect, useState } from "react";
import styles from "../activity.module.css";

export interface StalePillProps {
  fetchedAt: number;
  isFetching: boolean;
  onRefetch: () => void;
}

const TICK_MS = 15_000;

export function StalePill({ fetchedAt, isFetching, onRefetch }: StalePillProps) {
  const [, force] = useState(0);
  useEffect(() => {
    if (fetchedAt === 0) return undefined;
    const id = setInterval(() => force((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [fetchedAt]);

  if (fetchedAt === 0) return null;

  const elapsedMs = Date.now() - fetchedAt;
  const minutes = Math.floor(elapsedMs / 60_000);
  const ageLabel = minutes < 1 ? "just now" : `${minutes}m ago`;

  return (
    <div role="status" className={styles.stalePill}>
      <span>fetched</span>
      <span aria-live="polite" className={styles.stalePillAge}>
        {ageLabel}
      </span>
      <button
        type="button"
        className={`${styles.stalePillRefresh} ${isFetching ? styles.stalePillRefreshSpin : ""}`}
        onClick={onRefetch}
      >
        {isFetching ? "fetching…" : "refresh"}
      </button>
    </div>
  );
}
