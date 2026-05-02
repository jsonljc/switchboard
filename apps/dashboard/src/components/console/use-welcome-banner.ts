"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sb_welcome_dismissed";
const FLASH_DURATION_MS = 1000;

const SELECTORS: Record<TourStop, string> = {
  queue: 'section[aria-label="Queue"]',
  agents: ".zone3",
  activity: ".zone4",
};

export type TourStop = "queue" | "agents" | "activity";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useWelcomeBanner() {
  const [dismissed, setDismissed] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!dismissed) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore quota / private-mode failures
    }
  }, [dismissed]);

  const dismiss = useCallback(() => setDismissed(true), []);

  const tour = useCallback((stop: TourStop) => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(SELECTORS[stop]);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("is-flashing");
    setTimeout(() => el.classList.remove("is-flashing"), FLASH_DURATION_MS);
  }, []);

  return { dismissed, dismiss, tour };
}
