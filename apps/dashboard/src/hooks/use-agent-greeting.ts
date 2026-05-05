"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, GreetingViewModel } from "@/lib/agent-home/types";
import { getFixtureGreeting } from "@/app/(auth)/[agentKey]/_fixtures";

/**
 * PR-S1 fixture form. PR-S2 swaps the implementation to a React Query
 * call against /api/dashboard/agents/[agentId]/greeting; the public
 * AgentBlockQuery<GreetingViewModel> shape is preserved across the swap
 * so callers (page + block components) do not change.
 */
export function useAgentGreeting(agentKey: AgentKey): AgentBlockQuery<GreetingViewModel> {
  return {
    data: getFixtureGreeting(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
