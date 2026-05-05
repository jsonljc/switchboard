"use client";

import { useCallback, useState } from "react";
import { FIXTURES_BY_WINDOW, type ReportData, type ReportWindow } from "../fixtures";

export interface UseReportData {
  data: ReportData | undefined;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const _isLive = process.env.NEXT_PUBLIC_REPORTS_LIVE === "true";

export function useReportData(window: ReportWindow): UseReportData {
  const [, forceRefresh] = useState(0);

  const refresh = useCallback(async () => {
    forceRefresh((n) => n + 1);
  }, []);

  // PR-R3 will replace the _isLive branch with a React Query call.
  return {
    data: FIXTURES_BY_WINDOW[window],
    isLoading: false,
    error: null,
    refresh,
  };
}
