"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, WinsViewModel } from "@/lib/agent-home/types";
import { useScopedQueryKeys } from "./use-query-keys";

/**
 * Live wins hook. Fetches from the dashboard proxy
 * /api/dashboard/agents/[agentId]/wins, which forwards to the api server's
 * GET /api/dashboard/agents/:agentId/wins?window=… endpoint.
 *
 * Returns the same AgentBlockQuery<WinsViewModel> shape as the prior fixture
 * form so callers (WinsBlock, agent-home page) need no changes.
 */
export function useAgentWins(
  agentKey: AgentKey,
  window: "today" | "week" | "month" = "today",
): AgentBlockQuery<WinsViewModel> {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.wins.feed(agentKey, window) ?? ["__disabled_wins_feed__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/wins?window=${window}`);
      if (!res.ok) throw new Error(`Wins fetch failed (HTTP ${res.status})`);
      const json = (await res.json()) as { vm: WinsViewModel };
      return json.vm;
    },
    enabled: !!keys,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
