"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type {
  AgentBlockQuery,
  AgentBlockResponse,
  GreetingViewModel,
} from "@/lib/agent-home/types";

async function fetchGreeting(agentKey: AgentKey): Promise<GreetingViewModel> {
  const url = `/api/dashboard/agents/${encodeURIComponent(agentKey)}/greeting`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load greeting: ${res.status}`);
  }
  const body: AgentBlockResponse<GreetingViewModel> = await res.json();
  return body.data;
}

export function useAgentGreeting(agentKey: AgentKey): AgentBlockQuery<GreetingViewModel> {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.greeting.feed(agentKey) ?? ["__disabled_greeting__"],
    queryFn: () => fetchGreeting(agentKey),
    refetchInterval: 60_000,
    enabled: !!keys,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
