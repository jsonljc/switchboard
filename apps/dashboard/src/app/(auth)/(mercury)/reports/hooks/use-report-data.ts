"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { FIXTURES_BY_WINDOW, type ReportData, type ReportWindow } from "../fixtures";

export interface UseReportData {
  data: ReportData | undefined;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const isLive = process.env.NEXT_PUBLIC_REPORTS_LIVE === "true";

export function useReportData(window: ReportWindow): UseReportData {
  const keys = useScopedQueryKeys();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: keys?.reports.byWindow(window) ?? ["__disabled_reports__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/reports?window=${encodeURIComponent(window)}`);
      if (!res.ok) throw new Error(`Failed to load report: ${res.status}`);
      return res.json();
    },
    enabled: isLive && !!keys,
  });

  const refresh = useCallback(async () => {
    if (!isLive || !keys) return;
    const res = await fetch(`/api/dashboard/reports/refresh?window=${encodeURIComponent(window)}`, {
      method: "POST",
    });
    if (!res.ok) {
      console.warn(`Report refresh failed: ${res.status}`);
    }
    await queryClient.invalidateQueries({
      queryKey: keys.reports.byWindow(window),
    });
  }, [window, keys, queryClient]);

  if (!isLive) {
    return {
      data: FIXTURES_BY_WINDOW[window],
      isLoading: false,
      error: null,
      refresh: async () => {},
    };
  }

  return {
    data,
    isLoading,
    error: error as Error | null,
    refresh,
  };
}
