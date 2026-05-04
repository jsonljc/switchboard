"use client";

import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, PipelineViewModel } from "@/lib/agent-home/types";
import { getFixturePipeline } from "@/app/(auth)/[agentKey]/_fixtures";

export function useAgentPipeline(agentKey: AgentKey): AgentBlockQuery<PipelineViewModel> {
  return {
    data: getFixturePipeline(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
