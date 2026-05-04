"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, WinsViewModel } from "@/lib/agent-home/types";
import { getFixtureWins } from "@/app/(auth)/[agentKey]/_fixtures";

export function useAgentWins(agentKey: AgentKey): AgentBlockQuery<WinsViewModel> {
  return {
    data: getFixtureWins(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
