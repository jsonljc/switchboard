"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { DashboardOverview } from "@switchboard/schemas";

async function fetchOverview(): Promise<DashboardOverview> {
  const res = await fetch("/api/dashboard/overview");
  if (!res.ok) throw new Error("Failed to fetch dashboard overview");
  return res.json();
}

export function useDashboardOverview() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.dashboard.overview() ?? ["__disabled_dashboard_overview__"],
    queryFn: fetchOverview,
    refetchInterval: 60_000,
    retry: 1,
    enabled: !!keys,
  });
}
