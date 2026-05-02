// apps/dashboard/src/app/me/page.tsx
"use client";

import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useAgentRoster } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_ICONS } from "@/components/team/agent-icons";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/agent-status";
import { signOut } from "@/lib/sign-out";

export default function MePage() {
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

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
  const specialists = roster.filter(
    (a) => a.agentRole !== "primary_operator" && a.status !== "locked",
  );

  return (
    <div className="space-y-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Me</h1>

      {primaryOperator && (
        <section className="rounded-xl border border-border/60 bg-surface p-5 space-y-3">
          <h2 className="section-label">Your assistant</h2>
          <p className="text-[17px] font-semibold text-foreground">{primaryOperator.displayName}</p>
          <p className="text-[13px] text-muted-foreground">Primary operator</p>
        </section>
      )}

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
                  <span className="text-[13.5px] text-foreground flex-1">{agent.displayName}</span>
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

      <section className="space-y-2">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        <button
          onClick={() => signOut(queryClient)}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          Sign out
        </button>
      </section>

      <section>
        <h2 className="section-label mb-3">Settings</h2>
        <div className="space-y-2">
          {[
            { href: "/settings/playbook", label: "Playbook" },
            { href: "/settings/channels", label: "Channels" },
            { href: "/settings/knowledge", label: "Knowledge" },
            { href: "/settings/identity", label: "Identity" },
            { href: "/settings/team", label: "Team" },
            { href: "/settings/account", label: "Account" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-3.5 rounded-lg text-[15px] text-foreground hover:bg-surface border border-border/40 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
