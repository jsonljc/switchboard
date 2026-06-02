"use client";

import { useEffect, useRef } from "react";
import { feelMetrics } from "@/lib/feel-metrics";

/**
 * §2 queue-clear feel metric — time to clear a morning queue. Starts the clock
 * when `pendingCount` first rises above zero and emits queue_clear_ms when it
 * returns to zero, reporting the peak queue depth reached. A queue that loads
 * empty (never populated) never emits.
 */
export function useQueueClearMetric(pendingCount: number): void {
  const startRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  useEffect(() => {
    if (pendingCount > 0) {
      if (startRef.current === null) startRef.current = performance.now();
      if (pendingCount > peakRef.current) peakRef.current = pendingCount;
    } else if (startRef.current !== null) {
      feelMetrics.emit("queue_clear_ms", {
        durationMs: Math.round(performance.now() - startRef.current),
        itemsCleared: peakRef.current,
      });
      startRef.current = null;
      peakRef.current = 0;
    }
  }, [pendingCount]);
}
