"use client";

import Link from "next/link";
import { useAgentRoster } from "@/hooks/use-agents";
import { useApprovals } from "@/hooks/use-approvals";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { queryKeys } from "@/lib/query-keys";
import { StatCards } from "@/components/dashboard/stat-cards";
import { TodayActivityFeed } from "@/components/mission-control/today-activity-feed";
import { CONSEQUENCE } from "@/lib/approval-constants";
import { useToast } from "@/components/ui/use-toast";
import { FirstRunBanner } from "@/components/dashboard/first-run-banner";
import { useFirstRun } from "@/hooks/use-first-run";

export function OwnerToday() {
  const { data: session } = useSession();
  const { data: rosterData } = useAgentRoster();
  const { data: approvalsData } = useApprovals();
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { isFirstRun, dismissBanner } = useFirstRun();

  const operatorName =
    rosterData?.roster?.find((a) => a.agentRole === "primary_operator")?.displayName ??
    "Your assistant";

  const topApproval = approvalsData?.approvals?.[0];
  const remainingApprovals = (approvalsData?.approvals?.length ?? 0) - 1;

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
    onSuccess: (_data, variables) => {
      toast({
        title: variables.action === "approve" ? "Approved" : "Declined",
        description:
          variables.action === "approve"
            ? "The action will proceed."
            : "The action has been blocked.",
      });
    },
    onError: () => {
      toast({
        title: "Something went wrong",
        description: "Try again or check your connection.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setRespondingId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
    },
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-8">
      <p className="text-[20px] font-semibold text-foreground">{greeting}.</p>

      {isFirstRun && <FirstRunBanner onDismiss={dismissBanner} />}

      <StatCards
        stats={[{ label: "Pending approvals", value: approvalsData?.approvals?.length ?? 0 }]}
      />

      {topApproval && (
        <section>
          <h2 className="section-label mb-3">Needs you</h2>
          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <p className="text-[14.5px] text-foreground leading-relaxed">{topApproval.summary}</p>
            <p className="text-[12.5px] text-muted-foreground italic leading-snug">
              {CONSEQUENCE[topApproval.riskCategory] ?? CONSEQUENCE.medium}
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                onClick={() => {
                  setRespondingId(topApproval.id);
                  respondMutation.mutate({
                    approvalId: topApproval.id,
                    action: "approve",
                    bindingHash: topApproval.bindingHash,
                  });
                }}
                disabled={respondingId === topApproval.id}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {respondingId === topApproval.id && respondMutation.isPending
                  ? "Approving..."
                  : "Approve"}
              </button>
              <button
                onClick={() => {
                  setRespondingId(topApproval.id);
                  respondMutation.mutate({
                    approvalId: topApproval.id,
                    action: "reject",
                    bindingHash: topApproval.bindingHash,
                  });
                }}
                disabled={respondingId === topApproval.id}
                className="px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {respondingId === topApproval.id && respondMutation.isPending
                  ? "Declining..."
                  : "Not now"}
              </button>
              {remainingApprovals > 0 && (
                <Link
                  href="/decide"
                  className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {remainingApprovals} more →
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {!topApproval && (
        <section>
          <div className="rounded-xl border border-border/60 bg-surface-raised px-6 py-6 text-center">
            <p className="text-[14px] text-foreground font-medium">You&apos;re all caught up.</p>
            <p className="text-[13px] text-muted-foreground mt-1">
              {operatorName} will reach out when something needs you.
            </p>
          </div>
        </section>
      )}

      <section>
        <h2 className="section-label mb-3">What happened</h2>
        <TodayActivityFeed />
      </section>
    </div>
  );
}
