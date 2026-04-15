"use client";

import { useQuery } from "@tanstack/react-query";
import type { ExecutionTraceSummary } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useTraces(deploymentId: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.traces(deploymentId),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/deployments/${deploymentId}/traces`);
      if (!res.ok) throw new Error("Failed to fetch traces");
      const data = await res.json();
      return data as { traces: ExecutionTraceSummary[]; nextCursor?: string };
    },
    enabled: !!deploymentId,
  });
}
