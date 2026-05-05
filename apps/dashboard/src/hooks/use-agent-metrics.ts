"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, MetricsViewModel } from "@/lib/agent-home/types";
import { getFixtureMetrics } from "@/app/(auth)/[agentKey]/_fixtures";

export function useAgentMetrics(agentKey: AgentKey): AgentBlockQuery<MetricsViewModel> {
  return {
    data: getFixtureMetrics(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
