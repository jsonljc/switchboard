"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AGENT_ICONS, AGENT_ROLE_LABELS } from "./agent-icons";
import { Lock } from "lucide-react";
import type { AgentRosterEntry } from "@/lib/api-client";

interface AgentCardProps {
  agent: AgentRosterEntry;
  onClick?: () => void;
}

const STATUS_DOT: Record<string, string> = {
  idle: "bg-agent-idle",
  working: "bg-agent-active animate-pulse",
  analyzing: "bg-agent-active animate-pulse",
  waiting_approval: "bg-agent-attention animate-pulse",
  error: "bg-destructive animate-pulse",
};

const TIER_LABELS: Record<string, string> = {
  pro: "Coming with Pro",
  business: "Coming with Business",
};

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
  const roleLabel = AGENT_ROLE_LABELS[agent.agentRole] ?? agent.agentRole;
  const isLocked = agent.status === "locked";
  const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
  const statusDot = STATUS_DOT[activityStatus] ?? STATUS_DOT.idle;

  return (
    <Card
      className={`relative transition-colors ${
        isLocked ? "opacity-60" : "hover:border-primary/30 cursor-pointer"
      }`}
      onClick={isLocked ? undefined : onClick}
    >
      {isLocked && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60 z-10">
          <Badge variant="secondary" className="gap-1.5 text-xs">
            <Lock className="h-3 w-3" />
            {TIER_LABELS[agent.tier] ?? "Locked"}
          </Badge>
        </div>
      )}
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary flex-shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{agent.displayName}</h3>
              {!isLocked && <div className={`h-2 w-2 rounded-full ${statusDot}`} />}
            </div>
            <p className="text-xs text-muted-foreground">{roleLabel}</p>
            {!isLocked && agent.agentState?.currentTask && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {agent.agentState.currentTask}
              </p>
            )}
            {!isLocked && agent.agentState?.lastActionSummary && !agent.agentState?.currentTask && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                Last: {agent.agentState.lastActionSummary}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
