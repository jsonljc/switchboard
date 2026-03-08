"use client";

import Link from "next/link";
import { useAgentRoster, useAgentState } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Eye, MessageSquare, Gauge, Calendar, Shield, Sparkles } from "lucide-react";

const ROLE_ICONS: Record<string, React.ElementType> = {
  strategist: Brain,
  monitor: Eye,
  responder: MessageSquare,
  optimizer: Gauge,
  booker: Calendar,
  guardian: Shield,
  primary_operator: Sparkles,
};

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-agent-idle",
  working: "bg-agent-active animate-pulse",
  analyzing: "bg-agent-active animate-pulse",
  waiting_approval: "bg-agent-attention animate-pulse",
  error: "bg-destructive animate-pulse",
};

export function AgentStatusStrip() {
  const { data: rosterData, isLoading: rosterLoading } = useAgentRoster();
  const { data: stateData } = useAgentState();

  if (rosterLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-40 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const roster = rosterData?.roster ?? [];
  const activeAgents = roster.filter((a) => a.status === "active");
  const stateMap = new Map(stateData?.states?.map((s) => [s.agentRosterId, s]) ?? []);
  // Also build a role-based map from derived state
  const roleStateMap = new Map(
    stateData?.states?.map((s) => [(s as unknown as { agentRole?: string }).agentRole ?? "", s]) ??
      [],
  );

  return (
    <Link href="/team">
      <div className="flex gap-2 overflow-x-auto pb-2 cursor-pointer">
        {activeAgents.map((agent) => {
          const Icon = ROLE_ICONS[agent.agentRole] ?? Sparkles;
          const state = stateMap.get(agent.id) ?? agent.agentState;
          // Fall back to role-based derived state
          const derivedState = roleStateMap.get(agent.agentRole);
          const activityStatus =
            (state?.activityStatus as string) ?? (derivedState?.activityStatus as string) ?? "idle";
          const currentTask =
            state?.currentTask ?? (derivedState?.currentTask as string | null) ?? null;
          const statusColor = STATUS_COLORS[activityStatus] ?? STATUS_COLORS.idle;

          return (
            <div
              key={agent.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:border-primary/30 transition-colors flex-shrink-0"
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{agent.displayName}</span>
              <div className={`h-2 w-2 rounded-full ${statusColor}`} />
              {currentTask && (
                <span className="text-xs text-muted-foreground max-w-[120px] truncate">
                  {currentTask}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Link>
  );
}
