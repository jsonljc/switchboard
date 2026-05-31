"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery } from "@/lib/agent-home/types";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";
import { useScopedQueryKeys } from "./use-query-keys";

/**
 * Live metrics hook. Fetches from the dashboard proxy
 * /api/dashboard/agents/[agentId]/metrics?window=<window>, which forwards to
 * the api server. Returns AgentBlockQuery<MetricsViewModelWire> shape.
 *
 * A.3: Return type widened to MetricsViewModelWire (additive — targets,
 * spendCents, leads, qualifiedPct, bookedDelta, leadsDelta, qualifiedDelta).
 * Legacy API responses that omit these fields will surface as undefined;
 * consumers should null-coalesce where needed.
 *
 * @param metricWindow - "week" (default) for current-week scope. Lifetime
 *   ("all") scope is intentionally NOT accepted: projectMetrics is week-only
 *   server-side and 400s on any other window. The param is kept (week-only) so
 *   the lifetime window can be re-introduced deliberately when the lifetime-
 *   metrics backend lands (its own spec).
 */
export function useAgentMetrics(
  agentKey: AgentKey,
  metricWindow: "week" = "week",
): AgentBlockQuery<MetricsViewModelWire> {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.metrics.feed(agentKey, metricWindow) ?? ["__disabled_metrics_feed__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/metrics?window=${metricWindow}`);
      if (!res.ok) throw new Error(`Metrics fetch failed (HTTP ${res.status})`);
      const json = (await res.json()) as { vm: MetricsViewModelWire };
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
