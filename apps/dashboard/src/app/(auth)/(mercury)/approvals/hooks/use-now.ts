"use client";

import { useEffect, useState } from "react";

/**
 * Returns `now: number` updated every `intervalMs`. Pauses while the tab is
 * hidden and resumes on `visibilitychange`. Page-local for v1; promote to a
 * shared util when /mission or another surface adopts the same pattern.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timerId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timerId !== null) return;
      timerId = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timerId === null) return;
      clearInterval(timerId);
      timerId = null;
    };
    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        setNow(Date.now());
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs]);

  return now;
}
