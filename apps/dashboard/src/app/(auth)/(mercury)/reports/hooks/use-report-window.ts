"use client";

import { useEffect, useState } from "react";
import { DEFAULT_REPORT_WINDOW, REPORT_WINDOWS, type ReportWindow } from "../fixtures";

const STORAGE_KEY = "switchboard.reports.window.v1";

function isValidWindow(value: unknown): value is ReportWindow {
  return typeof value === "string" && (REPORT_WINDOWS as string[]).includes(value);
}

function readPersisted(): ReportWindow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isValidWindow(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writePersisted(value: ReportWindow): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage may be unavailable (private browsing, quota); ignore.
  }
}

export interface UseReportWindow {
  window: ReportWindow;
  setWindow: (value: ReportWindow) => void;
}

/**
 * Window-selector state for /reports, persisted to localStorage so a
 * reader returns to the same period on reload.
 *
 * SSR-safe: initial render uses the default; the persisted value is
 * applied in a post-mount effect to avoid hydration mismatch.
 */
export function useReportWindow(): UseReportWindow {
  const [value, setValue] = useState<ReportWindow>(DEFAULT_REPORT_WINDOW);

  // Read persisted value once on mount; subsequent updates flow through setWindow.
  useEffect(() => {
    const persisted = readPersisted();
    if (persisted) {
      setValue(persisted);
    }
  }, []);

  function setWindow(next: ReportWindow): void {
    setValue(next);
    writePersisted(next);
  }

  return { window: value, setWindow };
}

export const __TEST_ONLY__ = { STORAGE_KEY };
