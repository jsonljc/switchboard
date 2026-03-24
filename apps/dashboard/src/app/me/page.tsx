// apps/dashboard/src/app/me/page.tsx
"use client";

import { useSession, signOut } from "next-auth/react";
import { redirect } from "next/navigation";
import { useAgentRoster } from "@/hooks/use-agents";
import { useViewPreference } from "@/hooks/use-view-preference";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_ICONS, AGENT_ROLE_LABELS } from "@/components/team/agent-icons";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  idle: "bg-agent-idle",
  working: "bg-agent-active",
  analyzing: "bg-agent-active",
  waiting_approval: "bg-agent-attention",
  error: "bg-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  working: "Working",
  analyzing: "Analyzing",
  waiting_approval: "Waiting",
  error: "Error",
};

export default function MePage() {
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  const { setView } = useViewPreference();

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const roster = rosterData?.roster ?? [];
  const primaryOperator = roster.find((a) => a.agentRole === "primary_operator");
  const specialists = roster.filter((a) => a.agentRole !== "primary_operator" && a.status !== "locked");

  return (
    <div className="space-y-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Me</h1>

      {/* Identity summary */}
      {primaryOperator && (
        <section className="rounded-xl border border-border/60 bg-surface p-5 space-y-3">
          <h2 className="section-label">Your assistant</h2>
          <p className="text-[17px] font-semibold text-foreground">
            {primaryOperator.displayName}
          </p>
          <p className="text-[13px] text-muted-foreground">Primary operator</p>
        </section>
      )}

      {/* Team status */}
      {specialists.length > 0 && (
        <section>
          <h2 className="section-label mb-3">Team status</h2>
          <div className="space-y-2">
            {specialists.map((agent) => {
              const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
              const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
              const dot = STATUS_DOT[activityStatus] ?? STATUS_DOT.idle;
              const label = STATUS_LABEL[activityStatus] ?? "Ready";

              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface border border-border/40"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[13.5px] text-foreground flex-1">
                    {agent.displayName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className={cn("h-[6px] w-[6px] rounded-full", dot)} />
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Quick actions */}
      <section className="space-y-2">
        <button
          onClick={() => setView("staff")}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-foreground hover:bg-surface border border-border/40 transition-colors"
        >
          Staff view →
          <span className="block text-[12px] text-muted-foreground mt-0.5">
            Full dashboard access
          </span>
        </button>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
