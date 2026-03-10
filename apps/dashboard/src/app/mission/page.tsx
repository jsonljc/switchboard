"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApprovalCount, useApprovals } from "@/hooks/use-approvals";
import { useAgentRoster } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { TodayBanner } from "@/components/mission-control/today-banner";
import { TodayActivityFeed } from "@/components/mission-control/today-activity-feed";
import { MonthlyScorecard } from "@/components/mission-control/monthly-scorecard";

/* ─── Consequence copy by risk level ─── */
const CONSEQUENCE: Record<string, string> = {
  low: "Routine — asked as a precaution.",
  medium: "Affects a customer or involves money.",
  high: "Significant — take a moment to review.",
  critical: "Significant — take a moment to review.",
};

/* ─── Inline approval card ─── */
function MissionApprovalCard({
  approval,
  onApprove,
  onReject,
  isLoading,
}: {
  approval: { id: string; summary: string; bindingHash: string; riskCategory: string };
  onApprove: () => void;
  onReject: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
      <p className="text-[14.5px] text-foreground leading-relaxed">{approval.summary}</p>
      <p className="text-[12.5px] text-muted-foreground italic leading-snug">
        {CONSEQUENCE[approval.riskCategory] ?? CONSEQUENCE.medium}
      </p>
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={onApprove}
          disabled={isLoading}
          className="px-4 py-2 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={isLoading}
          className="px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Not now
        </button>
        <Link
          href="/approvals"
          className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          See all →
        </Link>
      </div>
    </div>
  );
}

export default function TodayPage() {
  const { status, data: session } = useSession();
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

  if (status === "unauthenticated") redirect("/login");

  const operatorName =
    rosterData?.roster?.find((a) => a.agentRole === "primary_operator")?.displayName ??
    "Your assistant";

  const approvals = approvalsData?.approvals?.slice(0, 3) ?? [];

  if (status === "loading" || rosterLoading) {
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
        <Skeleton className="h-24" />
      </div>
    );
  }

  return (
    <div className="space-y-14">
      {/* ── Zone 1: Outcome Banner ─────────────────────────────────── */}
      {/* Answers "Did I get leads today?" — business numbers first, AI status second */}
      <TodayBanner operatorName={operatorName} />

      {/* ── Zone 2: Two-column grid ────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 lg:gap-16">
        {/* Left: What happened — humanized, translated activity feed */}
        <div>
          <h2 className="section-label mb-5">What happened</h2>
          <TodayActivityFeed />
        </div>

        {/* Right: Needs you now — approvals with consequence context */}
        <div>
          <h2 className="section-label mb-5">Needs you now</h2>

          {approvals.length === 0 ? (
            <div
              className={cn(
                "rounded-xl border px-6 py-8 text-center",
                pendingCount === 0
                  ? "border-border/60 bg-surface-raised"
                  : "border-caution/30 bg-caution/[0.04]",
              )}
            >
              <p className="text-[14px] text-foreground font-medium">You&apos;re all caught up.</p>
              <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                {operatorName} will reach out when something needs you.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.map((approval) => (
                <MissionApprovalCard
                  key={approval.id}
                  approval={approval}
                  isLoading={respondingId === approval.id && respondMutation.isPending}
                  onApprove={() => {
                    setRespondingId(approval.id);
                    respondMutation.mutate({
                      approvalId: approval.id,
                      action: "approve",
                      bindingHash: approval.bindingHash,
                    });
                  }}
                  onReject={() => {
                    setRespondingId(approval.id);
                    respondMutation.mutate({
                      approvalId: approval.id,
                      action: "reject",
                      bindingHash: approval.bindingHash,
                    });
                  }}
                />
              ))}
              {pendingCount > 3 && (
                <Link
                  href="/approvals"
                  className="block text-center text-[13px] text-muted-foreground hover:text-foreground transition-colors py-2"
                >
                  {pendingCount - 3} more waiting →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Zone 3: Monthly Scorecard ──────────────────────────────── */}
      {/* CSS bar chart + narrative + month numbers */}
      <MonthlyScorecard />
    </div>
  );
}
