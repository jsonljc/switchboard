"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

interface DateRange {
  from: string;
  to: string;
}

interface FunnelCounts {
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
  totalRevenue: number;
}

interface RoiSummary {
  funnel: FunnelCounts;
  breakdown: Array<FunnelCounts & Record<string, string>>;
  health: { status: string; lastRun: string | null; checks: unknown[] };
}

async function fetchRoiSummary(dateRange: DateRange, breakdown: string): Promise<RoiSummary> {
  const params = new URLSearchParams({
    from: dateRange.from,
    to: dateRange.to,
    breakdown,
  });
  const res = await fetch(`/api/dashboard/roi?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch ROI summary");
  return res.json();
}

export function useRoiSummary(
  dateRange: DateRange,
  breakdown: "campaign" | "channel" | "agent" = "campaign",
) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.roi.summary({ from: dateRange.from, to: dateRange.to, breakdown }) ?? [
      "__disabled_roi_summary__",
    ],
    queryFn: () => fetchRoiSummary(dateRange, breakdown),
    staleTime: 5 * 60 * 1000,
    enabled: !!keys,
  });
}
