"use client";

import { useQuery } from "@tanstack/react-query";
import type { ExecutionTraceSummary } from "@/lib/api-client";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export function useTraces(deploymentId: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.traces(deploymentId) ?? ["__disabled_marketplace_traces__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/deployments/${deploymentId}/traces`);
      if (!res.ok) throw new Error("Failed to fetch traces");
      const data = await res.json();
      return data as { traces: ExecutionTraceSummary[]; nextCursor?: string };
    },
    enabled: !!deploymentId && !!keys,
  });
}
