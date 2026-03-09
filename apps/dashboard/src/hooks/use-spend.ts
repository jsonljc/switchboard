"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { OperatorSummary } from "@/lib/api-client";

export async function fetchOperatorSummary(): Promise<OperatorSummary> {
  const res = await fetch("/api/dashboard/operator-summary");
  if (!res.ok) {
    throw new Error("Failed to fetch operator summary");
  }

  const data = (await res.json()) as { summary?: OperatorSummary };
  if (!data.summary) {
    throw new Error("Operator summary payload is missing");
  }

  return data.summary;
}

export function useSpend() {
  return useQuery({
    queryKey: queryKeys.spend.summary(),
    queryFn: fetchOperatorSummary,
    refetchInterval: 60_000,
  });
}
