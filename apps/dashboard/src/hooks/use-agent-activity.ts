"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { AgentRosterEntry, AgentStateEntry } from "@/lib/api-client";
import { translateEvent, getEventIcon } from "@/components/activity/event-translator";
import { getAgentForAction } from "@/components/agents/agent-action-map";

export interface AuditEntryRaw {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  summary: string;
  snapshot: Record<string, unknown>;
  timestamp: string;
}

export interface TranslatedAction {
  id: string;
  agentRole: string;
  text: string;
  icon: "success" | "denied" | "pending" | "info" | "warning";
  timestamp: string;
  eventType: string;
  entityType: string;
  entityId: string;
}

export interface AgentActivityData {
  roster: AgentRosterEntry[];
  states: AgentStateEntry[];
  actions: TranslatedAction[];
}

interface ActivityResponse {
  roster: AgentRosterEntry[];
  states: AgentStateEntry[];
  auditEntries: AuditEntryRaw[];
}

function translateEntries(entries: AuditEntryRaw[]): TranslatedAction[] {
  return entries
    .map((entry) => {
      const actionType =
        (entry.snapshot.actionType as string | undefined) ?? entry.entityType ?? "";
      const agentRole = getAgentForAction(actionType) ?? "unknown";

      return {
        id: entry.id,
        agentRole,
        text: translateEvent(entry),
        icon: getEventIcon(entry.eventType),
        timestamp: entry.timestamp,
        eventType: entry.eventType,
        entityType: entry.entityType,
        entityId: entry.entityId,
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

async function fetchAgentActivity(days: number): Promise<AgentActivityData> {
  const res = await fetch(`/api/dashboard/agents/activity?days=${days}`);
  if (!res.ok) throw new Error("Failed to fetch agent activity");
  const data: ActivityResponse = await res.json();
  return {
    roster: data.roster,
    states: data.states,
    actions: translateEntries(data.auditEntries),
  };
}

export function useAgentActivity(days = 1) {
  return useQuery({
    queryKey: [...queryKeys.agents.activity(), days],
    queryFn: () => fetchAgentActivity(days),
    refetchInterval: 30_000,
  });
}
