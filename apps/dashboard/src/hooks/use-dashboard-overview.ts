"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { DashboardOverview } from "@switchboard/schemas";

async function fetchOverview(): Promise<DashboardOverview> {
  const res = await fetch("/api/dashboard/overview");
  if (!res.ok) throw new Error("Failed to fetch dashboard overview");
  return res.json();
}

export function useDashboardOverview() {
  return useQuery({
    queryKey: queryKeys.dashboard.overview(),
    queryFn: fetchOverview,
    refetchInterval: 60_000,
    retry: 1,
  });
}
