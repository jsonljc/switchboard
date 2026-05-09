"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { Decision } from "@/lib/decisions/types";

interface DecisionFeedResponse {
  decisions: Decision[];
  counts: { total: number; approval: number; handoff: number };
}

async function fetchDecisionFeed(agentKey: AgentKey | null): Promise<DecisionFeedResponse> {
  const url = agentKey ? `/api/dashboard/agents/${agentKey}/decisions` : `/api/dashboard/decisions`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load decisions");
  return res.json();
}

export function useDecisionFeed(agentKey: AgentKey | null) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.decisions.feed(agentKey) ?? ["__disabled_decision_feed__"],
    queryFn: () => fetchDecisionFeed(agentKey),
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}
