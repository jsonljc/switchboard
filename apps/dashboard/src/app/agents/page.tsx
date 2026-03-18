"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings, CheckCircle2, XCircle, Clock, AlertTriangle, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import type { TranslatedAction } from "@/hooks/use-agent-activity";
import { agentRoleLabel } from "@/components/agents/agent-action-map";

/* ---- Helpers ---- */

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ICON_MAP = {
  success: { Icon: CheckCircle2, color: "text-emerald-500" },
  denied: { Icon: XCircle, color: "text-red-500" },
  pending: { Icon: Clock, color: "text-amber-500" },
  warning: { Icon: AlertTriangle, color: "text-amber-500" },
  info: { Icon: Info, color: "text-blue-500" },
} as const;

const TIME_FILTERS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
] as const;

/* ---- ActionRow ---- */

function ActionRow({ action }: { action: TranslatedAction }) {
  const { Icon, color } = ICON_MAP[action.icon];
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0">
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", color)} />
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium text-muted-foreground">
          {agentRoleLabel(action.agentRole)}
        </span>
        <p className="text-[13px] text-foreground leading-snug mt-0.5">{action.text}</p>
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">
        {formatTimeAgo(action.timestamp)}
      </span>
    </div>
  );
}

/* ---- Page ---- */

export default function AgentsPage() {
  const { status } = useSession();
  const [days, setDays] = useState<number>(1);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const { data, isLoading } = useAgentActivity(days);

  if (status === "unauthenticated") redirect("/login");

  const roster = data?.roster ?? [];
  const states = data?.states ?? [];
  const actions = data?.actions ?? [];

  // Build per-agent stats
  const agentStats = roster.map((agent) => {
    const state = states.find((s) => s.agentRosterId === agent.id);
    const agentActions = actions.filter((a) => a.agentRole === agent.agentRole);
    const lastAction = agentActions[0];
    const activityStatus = state?.activityStatus ?? "idle";

    return { agent, state, actionCount: agentActions.length, lastAction, activityStatus };
  });

  const filteredActions = activeAgent
    ? actions.filter((a) => a.agentRole === activeAgent)
    : actions;

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Agents</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            What your AI team is doing right now.
          </p>
        </div>
        <Link
          href="/team"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground border border-border hover:border-foreground/20 transition-colors"
        >
          <Settings className="h-3.5 w-3.5" />
          Configure
        </Link>
      </section>

      {/* Agent status cards */}
      <section>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : roster.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">No agents configured yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {agentStats.map(({ agent, actionCount, lastAction, activityStatus }) => {
              const isSelected = activeAgent === agent.agentRole;
              const statusColor =
                activityStatus === "working"
                  ? "bg-emerald-500"
                  : activityStatus === "blocked"
                    ? "bg-red-500"
                    : "bg-zinc-400";
              const statusLabel =
                activityStatus === "working"
                  ? "Working"
                  : activityStatus === "blocked"
                    ? "Blocked"
                    : "Idle";

              return (
                <button
                  key={agent.id}
                  onClick={() => setActiveAgent(isSelected ? null : agent.agentRole)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    isSelected
                      ? "border-foreground/30 bg-muted/50"
                      : "border-border hover:border-foreground/20 bg-surface",
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                    <span className="text-[13px] font-medium text-foreground truncate">
                      {agent.displayName}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {statusLabel} &middot; {actionCount} action{actionCount !== 1 ? "s" : ""}
                  </p>
                  {lastAction && (
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      Last: {formatTimeAgo(lastAction.timestamp)}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Time filter + agent filter badge */}
      <section className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          {TIME_FILTERS.map((tf) => (
            <button
              key={tf.days}
              onClick={() => setDays(tf.days)}
              className={cn(
                "px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
                days === tf.days
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {activeAgent && (
          <button
            onClick={() => setActiveAgent(null)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium bg-muted text-foreground"
          >
            {agentRoleLabel(activeAgent)}
            <span className="text-muted-foreground hover:text-foreground ml-0.5">&times;</span>
          </button>
        )}
      </section>

      {/* Activity timeline */}
      <section>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : filteredActions.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[15px] text-foreground font-medium">No activity yet.</p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              Agent actions will appear here as they work.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface px-4">
            {filteredActions.map((action) => (
              <ActionRow key={action.id} action={action} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
