"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useAgentRoster, useAgentState, useInitializeRoster } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_ICONS, AGENT_ROLE_LABELS } from "@/components/team/agent-icons";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentRosterEntry } from "@/lib/api-client";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  idle: { dot: "bg-agent-idle", label: "Ready" },
  working: { dot: "bg-agent-active animate-pulse", label: "Working" },
  analyzing: { dot: "bg-agent-active animate-pulse", label: "Analyzing" },
  waiting_approval: { dot: "bg-agent-attention animate-pulse", label: "Waiting" },
  error: { dot: "bg-destructive animate-pulse", label: "Error" },
};

const TIER_LABELS: Record<string, string> = {
  pro: "Pro",
  business: "Business",
};

function AgentCard({ agent, onClick }: { agent: AgentRosterEntry; onClick: () => void }) {
  const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
  const roleLabel = AGENT_ROLE_LABELS[agent.agentRole] ?? agent.agentRole;
  const isLocked = agent.status === "locked";
  const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
  const statusStyle = STATUS_STYLES[activityStatus] ?? STATUS_STYLES.idle;

  return (
    <div
      onClick={isLocked ? undefined : onClick}
      className={cn(
        "relative rounded-xl border bg-surface p-6 transition-all duration-fast",
        isLocked
          ? "opacity-50 border-border/50"
          : "border-border hover:border-foreground/20 cursor-pointer group",
      )}
    >
      {isLocked && (
        <div className="absolute top-4 right-4">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
            <Lock className="h-3 w-3" />
            {TIER_LABELS[agent.tier] ?? "Locked"}
          </span>
        </div>
      )}

      {/* Agent mark */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        {!isLocked && (
          <div className="flex items-center gap-1.5">
            <div className={cn("h-[7px] w-[7px] rounded-full", statusStyle.dot)} />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {statusStyle.label}
            </span>
          </div>
        )}
      </div>

      <h3 className="text-[15px] font-semibold text-foreground mb-0.5">{agent.displayName}</h3>
      <p className="text-[13px] text-muted-foreground">{roleLabel}</p>

      {!isLocked && (
        <div className="mt-3 min-h-[18px]">
          {agent.agentState?.currentTask ? (
            <p className="text-[12.5px] text-muted-foreground leading-snug line-clamp-2">
              {agent.agentState.currentTask}
            </p>
          ) : agent.agentState?.lastActionSummary ? (
            <p className="text-[12.5px] text-muted-foreground leading-snug line-clamp-2">
              {agent.agentState.lastActionSummary}
            </p>
          ) : null}
        </div>
      )}

      {!isLocked && (
        <span className="mt-4 inline-block text-[12px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
          Configure →
        </span>
      )}
    </div>
  );
}

function PrimaryCard({ agent, onClick }: { agent: AgentRosterEntry; onClick: () => void }) {
  const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
  const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
  const statusStyle = STATUS_STYLES[activityStatus] ?? STATUS_STYLES.idle;

  return (
    <div
      onClick={onClick}
      className="rounded-xl border border-foreground/12 bg-surface p-7 cursor-pointer hover:border-foreground/25 transition-all duration-fast group"
    >
      <div className="flex items-start gap-5">
        <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-[17px] font-semibold text-foreground">{agent.displayName}</h2>
            <div className={cn("h-[7px] w-[7px] rounded-full", statusStyle.dot)} />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {statusStyle.label}
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground">Primary operator</p>
          {agent.agentState?.currentTask && (
            <p className="text-[14px] text-foreground mt-3 leading-relaxed">
              {agent.agentState.currentTask}
            </p>
          )}
          {!agent.agentState?.currentTask && agent.agentState?.lastActionSummary && (
            <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed">
              Last: {agent.agentState.lastActionSummary}
            </p>
          )}
        </div>
        <span className="text-[13px] text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0 self-start mt-1">
          →
        </span>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  useAgentState(); // prefetch — populates agentState on roster entries
  const initializeRoster = useInitializeRoster();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && rosterData && rosterData.roster.length === 0 && !initializeRoster.isPending) {
      initializeRoster.mutate();
    }
  }, [isLoading, rosterData, initializeRoster]);

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  const roster = rosterData?.roster ?? [];
  const primaryOperator = roster.find((a) => a.agentRole === "primary_operator");
  const allSpecialists = roster.filter((a) => a.agentRole !== "primary_operator");
  const activeSpecialists = allSpecialists.filter((a) => a.status !== "locked");
  const lockedCount = allSpecialists.filter((a) => a.status === "locked").length;

  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Your team</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          The specialists working for your business.
        </p>
      </section>

      {/* Primary operator */}
      {primaryOperator && (
        <section>
          <PrimaryCard
            agent={primaryOperator}
            onClick={() => router.push(`/team/${primaryOperator.id}`)}
          />
        </section>
      )}

      {/* Active specialists only — locked agents removed from main grid */}
      {activeSpecialists.length > 0 && (
        <section className="space-y-4">
          <h2 className="section-label">Specialists</h2>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {activeSpecialists.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onClick={() => router.push(`/team/${agent.id}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Locked agents — quiet footer callout instead of disabled cards in the grid */}
      {lockedCount > 0 && (
        <section className="pt-4 border-t border-border/40">
          <p className="text-[13px] text-muted-foreground">
            {lockedCount} more specialist{lockedCount > 1 ? "s" : ""} available on higher plans.{" "}
            <a
              href="/settings"
              className="text-foreground underline underline-offset-2 hover:no-underline transition-all"
            >
              View settings →
            </a>
          </p>
        </section>
      )}
    </div>
  );
}
