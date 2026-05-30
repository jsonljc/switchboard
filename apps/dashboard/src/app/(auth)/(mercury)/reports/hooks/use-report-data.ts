"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import { FIXTURES_BY_WINDOW, type ReportData, type ReportWindow } from "../fixtures";

export interface UseReportData {
  data: ReportData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
}

// Captured at module load; the existing test file relies on this (its per-test
// env mutations happen after the static import and don't affect this binding).
// Production inlines NEXT_PUBLIC_* at build time, so this is constant either way.
const isLive = isMercuryToolLive("reports");

export function useReportData(window: ReportWindow): UseReportData {
  const keys = useScopedQueryKeys();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery<ReportData>({
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

  const retry = useCallback(async () => {
    if (!isLive || !keys) return;
    await refetch();
  }, [keys, refetch]);

  if (!isLive) {
    return {
      data: FIXTURES_BY_WINDOW[window],
      isLoading: false,
      isFetching: false,
      error: null,
      refresh: async () => {},
      retry: async () => {},
    };
  }

  return {
    data,
    isLoading,
    isFetching,
    error: error as Error | null,
    refresh,
    retry,
  };
}
