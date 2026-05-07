"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, PipelineViewModel } from "@/lib/agent-home/types";
import { useScopedQueryKeys } from "./use-query-keys";

/**
 * Live pipeline hook. Fetches from the dashboard proxy
 * /api/dashboard/agents/[agentId]/pipeline, which forwards to the api server's
 * GET /api/dashboard/agents/:agentId/pipeline endpoint.
 *
 * Pipeline has no `window` parameter (unlike wins/metrics) — it's a
 * current-state view, not a time-windowed aggregation.
 *
 * Returns the same AgentBlockQuery<PipelineViewModel> shape as the prior
 * fixture form so callers (PipelineBlock, agent-home page) need no changes.
 */
export function useAgentPipeline(agentKey: AgentKey): AgentBlockQuery<PipelineViewModel> {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.pipeline.feed(agentKey) ?? ["__disabled_pipeline_feed__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/pipeline`);
      if (!res.ok) throw new Error(`Pipeline fetch failed (HTTP ${res.status})`);
      const json = (await res.json()) as { vm: PipelineViewModel };
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
