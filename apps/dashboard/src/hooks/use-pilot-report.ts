"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { PilotReportData } from "@/lib/api-client-types";

async function fetchPilotReport(): Promise<PilotReportData | null> {
  const res = await fetch("/api/dashboard/reports/pilot");
  if (!res.ok) throw new Error("Failed to fetch pilot report");
  const data = (await res.json()) as { report: PilotReportData | null };
  return data.report;
}

export function usePilotReport() {
  return useQuery({
    queryKey: queryKeys.reports.pilot(),
    queryFn: fetchPilotReport,
    refetchInterval: 300_000, // 5 min
  });
}
