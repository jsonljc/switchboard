"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { AgentRosterEntry, AgentStateEntry } from "@/lib/api-client";

async function fetchRoster(): Promise<{ roster: AgentRosterEntry[] }> {
  const res = await fetch("/api/dashboard/agents/roster");
  if (!res.ok) throw new Error("Failed to fetch agent roster");
  return res.json();
}

async function fetchState(): Promise<{ states: AgentStateEntry[] }> {
  const res = await fetch("/api/dashboard/agents/state");
  if (!res.ok) throw new Error("Failed to fetch agent state");
  return res.json();
}

export function useAgentRoster() {
  return useQuery({
    queryKey: queryKeys.agents.roster(),
    queryFn: fetchRoster,
  });
}

export function useUpdateAgentRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      displayName?: string;
      description?: string;
      status?: string;
      config?: Record<string, unknown>;
    }) => {
      const res = await fetch(`/api/dashboard/agents/roster/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update agent");
      }
      return res.json() as Promise<{ agent: AgentRosterEntry }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useAgentState() {
  return useQuery({
    queryKey: queryKeys.agents.state(),
    queryFn: fetchState,
    // 60s: agent state is informational on Mission Control; 30s was unnecessarily aggressive
    refetchInterval: 60_000,
  });
}

export function useInitializeRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      body?: {
        operatorName?: string;
        operatorConfig?: Record<string, unknown>;
      } | void,
    ) => {
      const res = await fetch("/api/dashboard/agents/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to initialize roster");
      }
      return res.json() as Promise<{
        roster: AgentRosterEntry[];
        alreadyInitialized?: boolean;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}
