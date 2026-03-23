"use client";

import { AGENT_ICONS, AGENT_ROLE_LABELS } from "./agent-icons";
import { cn } from "@/lib/utils";

interface AgentConfigIdentityProps {
  agentRole: string;
  displayName: string;
  activityStatus: string;
  metrics: Record<string, unknown>;
  previewText: string;
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  idle: { dot: "bg-agent-idle", label: "Ready" },
  working: { dot: "bg-agent-active animate-pulse", label: "Working" },
  analyzing: { dot: "bg-agent-active animate-pulse", label: "Analyzing" },
  waiting_approval: { dot: "bg-agent-attention animate-pulse", label: "Waiting" },
  error: { dot: "bg-destructive animate-pulse", label: "Error" },
};

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AgentConfigIdentity({
  agentRole,
  displayName,
  activityStatus,
  metrics,
  previewText,
}: AgentConfigIdentityProps) {
  const Icon = AGENT_ICONS[agentRole] ?? AGENT_ICONS.primary_operator;
  const roleLabel = AGENT_ROLE_LABELS[agentRole] ?? agentRole;
  const statusStyle = STATUS_STYLES[activityStatus] ?? STATUS_STYLES.idle;

  const activeConversations = metrics.activeConversations as number | undefined;
  const actionsToday = metrics.actionsToday as number | undefined;
  const lastActiveAt = metrics.lastActiveAt as string | undefined;

  return (
    <div className="flex flex-col items-center text-center space-y-4">
      <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>

      <div>
        <h2 className="text-[17px] font-semibold text-foreground">{displayName}</h2>
        <p className="text-[13px] text-muted-foreground">{roleLabel}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <div className={cn("h-[7px] w-[7px] rounded-full", statusStyle.dot)} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {statusStyle.label}
        </span>
      </div>

      {(activeConversations != null || actionsToday != null || lastActiveAt) && (
        <div className="flex flex-wrap justify-center gap-4 text-[12px] text-muted-foreground">
          {activeConversations != null && <span>{activeConversations} active chats</span>}
          {actionsToday != null && <span>{actionsToday} actions today</span>}
          {lastActiveAt && <span>Last active {formatTimeAgo(lastActiveAt)}</span>}
        </div>
      )}

      {/* Preview bubble */}
      {previewText && (
        <div className="w-full mt-2 rounded-lg bg-muted/50 border border-border/50 p-4">
          <p className="text-[12px] text-muted-foreground mb-1">Preview</p>
          <p className="text-[13px] text-foreground italic leading-relaxed whitespace-pre-line">
            {previewText}
          </p>
        </div>
      )}
    </div>
  );
}
