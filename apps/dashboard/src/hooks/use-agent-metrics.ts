"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, MetricsViewModel } from "@/lib/agent-home/types";
import { useScopedQueryKeys } from "./use-query-keys";

/**
 * Live metrics hook. Fetches from the dashboard proxy
 * /api/dashboard/agents/[agentId]/metrics?window=week, which forwards to the
 * api server. Returns AgentBlockQuery<MetricsViewModel> shape.
 */
export function useAgentMetrics(agentKey: AgentKey): AgentBlockQuery<MetricsViewModel> {
  const keys = useScopedQueryKeys();
  const window = "week";
  const query = useQuery({
    queryKey: keys?.metrics.feed(agentKey, window) ?? ["__disabled_metrics_feed__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/metrics?window=${window}`);
      if (!res.ok) throw new Error(`Metrics fetch failed (HTTP ${res.status})`);
      const json = (await res.json()) as { vm: MetricsViewModel };
      return json.vm;
    },
    enabled: !!keys,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
