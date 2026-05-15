"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { useHalt } from "@/components/layout/halt/halt-context";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

async function fetchMission(agentKey: string): Promise<MissionAggregatorResponse> {
  const url = `/api/dashboard/agents/${encodeURIComponent(agentKey)}/mission`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load mission: ${res.status}`);
  }
  return (await res.json()) as MissionAggregatorResponse;
}

export function useAgentMission(agentKey: string) {
  const keys = useScopedQueryKeys();
  const { halted } = useHalt();
  const query = useQuery({
    queryKey: keys
      ? [...keys.mission.detail(agentKey), halted ? "halted" : "live"]
      : ["__disabled_mission__"],
    queryFn: () => fetchMission(agentKey),
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
