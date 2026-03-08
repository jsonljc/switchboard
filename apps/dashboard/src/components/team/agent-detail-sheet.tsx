"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useAudit } from "@/hooks/use-audit";
import { AGENT_ICONS, AGENT_ROLE_LABELS } from "./agent-icons";
import type { AgentRosterEntry } from "@/lib/api-client";

interface AgentDetailSheetProps {
  agent: AgentRosterEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  analyzing: "Analyzing",
  waiting_approval: "Waiting for Approval",
  error: "Error",
};

export function AgentDetailSheet({ agent, open, onOpenChange }: AgentDetailSheetProps) {
  const { data: auditData } = useAudit({ limit: 10 });

  if (!agent) return null;

  const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
  const roleLabel = AGENT_ROLE_LABELS[agent.agentRole] ?? agent.agentRole;
  const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";

  // Filter audit entries relevant to this agent's role
  const recentActivity = auditData?.entries?.slice(0, 5) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <SheetTitle>{agent.displayName}</SheetTitle>
              <p className="text-sm text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Status */}
          <div>
            <h4 className="text-sm font-medium mb-2">Status</h4>
            <Badge variant={activityStatus === "error" ? "destructive" : "secondary"}>
              {STATUS_LABELS[activityStatus] ?? activityStatus}
            </Badge>
          </div>

          {/* Description */}
          <div>
            <h4 className="text-sm font-medium mb-2">Responsibilities</h4>
            <p className="text-sm text-muted-foreground">{agent.description}</p>
          </div>

          {/* Current Task */}
          {agent.agentState?.currentTask && (
            <div>
              <h4 className="text-sm font-medium mb-2">Current Task</h4>
              <p className="text-sm text-muted-foreground">{agent.agentState.currentTask}</p>
            </div>
          )}

          {/* Recent Activity */}
          <div>
            <h4 className="text-sm font-medium mb-2">Recent Activity</h4>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity</p>
            ) : (
              <div className="space-y-2">
                {recentActivity.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between text-sm py-1 border-b last:border-0"
                  >
                    <span className="truncate flex-1">{entry.summary}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                      {formatRelativeTime(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
