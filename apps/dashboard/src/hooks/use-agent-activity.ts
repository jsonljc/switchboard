"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { AgentRosterEntry, AgentStateEntry } from "@/lib/api-client-types";
import { translateEvent, getEventIcon } from "@/components/activity/event-translator";
import { translateRileyActivity } from "@/lib/cockpit/riley/riley-activity-translator";
import { coldStateActivityRows } from "@/lib/cockpit/riley/cold-state-activity-rows";
import { useConnections } from "./use-connections";
import type { ActivityRow } from "@/components/cockpit/types";

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
      const agentRole = (entry.snapshot.agentRole as string | undefined) ?? "unknown";

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
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys ? [...keys.agents.activity(), days] : ["__disabled_agents_activity__", days],
    queryFn: () => fetchAgentActivity(days),
    refetchInterval: 30_000,
    enabled: !!keys,
  });
}

// --- Riley B.1 — useRileyActivity (composes useAgentActivity + useConnections + Riley adapters) ---

export function useRileyActivity(): { rows: ActivityRow[]; isLoading: boolean; isError: boolean } {
  const base = useAgentActivity(1);
  const connectionsQuery = useConnections();

  const hasMetaConnection = (connectionsQuery.data?.connections ?? []).some(
    (c) => c.serviceId === "meta-ads",
  );

  if (!hasMetaConnection) {
    return { rows: coldStateActivityRows(), isLoading: false, isError: false };
  }

  const rileyActions = (base.data?.actions ?? []).filter((a) => a.agentRole === "riley");
  return {
    rows: translateRileyActivity(rileyActions),
    isLoading: base.isLoading || connectionsQuery.isLoading,
    isError: base.isError || connectionsQuery.isError,
  };
}
