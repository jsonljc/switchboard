"use client";

import { useCallback, useState } from "react";
import { FIXTURES_BY_WINDOW, type ReportData, type ReportWindow } from "../fixtures";

export interface UseReportData {
  data: ReportData | undefined;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useReportData(window: ReportWindow): UseReportData {
  const [, forceRefresh] = useState(0);

  const refresh = useCallback(async () => {
    forceRefresh((n) => n + 1);
  }, []);

  return {
    data: FIXTURES_BY_WINDOW[window],
    isLoading: false,
    error: null,
    refresh,
  };
}
