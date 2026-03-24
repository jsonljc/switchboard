"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useApprovalCount, useApprovals } from "@/hooks/use-approvals";
import { useAgentRoster } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query-keys";
import { TodayBanner } from "@/components/mission-control/today-banner";
import { TodayActivityFeed } from "@/components/mission-control/today-activity-feed";
import { MonthlyScorecard } from "@/components/mission-control/monthly-scorecard";
import { AGENT_ICONS } from "@/components/team/agent-icons";
import { cn } from "@/lib/utils";
import { CONSEQUENCE } from "@/lib/approval-constants";
import { STATUS_DOT_ANIMATED, STATUS_LABEL } from "@/lib/agent-status";

export function StaffDashboard() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const pendingCount = useApprovalCount();
  const { data: approvalsData } = useApprovals();
  const { data: rosterData, isLoading: rosterLoading } = useAgentRoster();

  const [respondingId, setRespondingId] = useState<string | null>(null);

  const respondMutation = useMutation({
    mutationFn: async ({
      approvalId,
      action,
      bindingHash,
    }: {
      approvalId: string;
      action: string;
      bindingHash: string;
    }) => {
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action,
          respondedBy: (session as { principalId?: string })?.principalId ?? "dashboard-user",
          bindingHash,
        }),
      });
      if (!res.ok) throw new Error("Failed to respond");
      return res.json();
    },
    onSettled: () => {
      setRespondingId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });

  const operatorName =
    rosterData?.roster?.find((a) => a.agentRole === "primary_operator")?.displayName ??
    "Your assistant";

  const approvals = approvalsData?.approvals?.slice(0, 3) ?? [];
  const roster = rosterData?.roster ?? [];
  const activeAgents = roster.filter((a) => a.status !== "locked");

  if (rosterLoading) {
    return (
      <div className="space-y-14">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-14">
      <TodayBanner operatorName={operatorName} />

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 lg:gap-16">
        <div>
          <h2 className="section-label mb-5">What happened</h2>
          <TodayActivityFeed />
        </div>

        <div>
          <h2 className="section-label mb-5">Needs attention</h2>

          {approvals.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-surface-raised px-6 py-8 text-center">
              <p className="text-[14px] text-foreground font-medium">You&apos;re all caught up.</p>
              <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                {operatorName} will reach out when something needs you.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.map((approval) => (
                <div
                  key={approval.id}
                  className="rounded-xl border border-border bg-surface p-5 space-y-3"
                >
                  <p className="text-[14.5px] text-foreground leading-relaxed">
                    {approval.summary}
                  </p>
                  <p className="text-[12.5px] text-muted-foreground italic leading-snug">
                    {CONSEQUENCE[approval.riskCategory] ?? CONSEQUENCE.medium}
                  </p>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      onClick={() => {
                        setRespondingId(approval.id);
                        respondMutation.mutate({
                          approvalId: approval.id,
                          action: "approve",
                          bindingHash: approval.bindingHash,
                        });
                      }}
                      disabled={respondingId === approval.id && respondMutation.isPending}
                      className="px-4 py-2 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        setRespondingId(approval.id);
                        respondMutation.mutate({
                          approvalId: approval.id,
                          action: "reject",
                          bindingHash: approval.bindingHash,
                        });
                      }}
                      disabled={respondingId === approval.id && respondMutation.isPending}
                      className="px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Not now
                    </button>
                    <Link
                      href="/decide"
                      className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      See all →
                    </Link>
                  </div>
                </div>
              ))}
              {pendingCount > 3 && (
                <Link
                  href="/decide"
                  className="block text-center text-[13px] text-muted-foreground hover:text-foreground transition-colors py-2"
                >
                  {pendingCount - 3} more waiting →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <MonthlyScorecard />

      {activeAgents.length > 0 && (
        <section>
          <h2 className="section-label mb-4">Agent status</h2>
          <div className="flex flex-wrap gap-4">
            {activeAgents.map((agent) => {
              const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
              const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
              const dot = STATUS_DOT_ANIMATED[activityStatus] ?? STATUS_DOT_ANIMATED.idle;
              const label = STATUS_LABEL[activityStatus] ?? "Ready";

              return (
                <Link
                  key={agent.id}
                  href={`/settings/team/${agent.id}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-surface hover:border-border transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[13px] text-foreground">{agent.displayName}</span>
                  <div className={cn("h-[6px] w-[6px] rounded-full", dot)} />
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
