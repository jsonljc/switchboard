"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { useFirstRun } from "@/hooks/use-first-run";
import { FirstRunBanner } from "@/components/dashboard/first-run-banner";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { StatCardGrid } from "@/components/dashboard/stat-card-grid";
import { SectionLabel } from "@/components/dashboard/section-label";
import { ActionCard } from "@/components/dashboard/action-card";
import { BookingPreview } from "@/components/dashboard/booking-preview";
import { FunnelStrip } from "@/components/dashboard/funnel-strip";
import { RevenueSummary } from "@/components/dashboard/revenue-summary";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { OwnerTaskList } from "@/components/dashboard/owner-task-list";
import { CONSEQUENCE } from "@/lib/approval-constants";

export function OwnerToday() {
  const { data: session } = useSession();
  const { data: overview, isLoading, isError } = useDashboardOverview();
  const { isFirstRun, dismissBanner } = useFirstRun();
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const { toast } = useToast();

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
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
    },
  });

  const handleTaskComplete = async (taskId: string) => {
    await fetch("/api/dashboard/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status: "completed" }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  };

  if (isError) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
    return (
      <div
        style={{
          maxWidth: "64rem",
          margin: "0 auto",
          padding: "48px",
          background: "var(--sw-base)",
          minHeight: "100vh",
        }}
        className="px-6 md:px-12"
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "24px",
            fontWeight: 600,
            color: "var(--sw-text-primary)",
            margin: 0,
          }}
        >
          {greeting}
        </h1>
        <div
          style={{
            marginTop: "48px",
            background: "var(--sw-surface-raised)",
            border: "1px solid var(--sw-border)",
            borderRadius: "12px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", margin: 0 }}>
            Unable to load dashboard data. Check that the API server is running.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !overview) {
    return (
      <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "48px" }}>
        <div
          style={{
            height: "32px",
            background: "var(--sw-surface)",
            borderRadius: "8px",
            width: "200px",
            marginBottom: "48px",
          }}
        />
        <div
          style={{ display: "grid", gap: "16px" }}
          className="grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: "96px",
                background: "var(--sw-surface-raised)",
                border: "1px solid var(--sw-border)",
                borderRadius: "12px",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Pending approvals", value: overview.stats.pendingApprovals },
    {
      label: "New inquiries",
      value: overview.stats.newInquiriesToday,
      delta:
        overview.stats.newInquiriesYesterday > 0
          ? {
              direction: (overview.stats.newInquiriesToday >= overview.stats.newInquiriesYesterday
                ? "up"
                : "down") as "up" | "down",
              text: `${Math.abs(overview.stats.newInquiriesToday - overview.stats.newInquiriesYesterday)} vs yesterday`,
            }
          : undefined,
    },
    { label: "Qualified leads", value: overview.stats.qualifiedLeads },
    { label: "Bookings today", value: overview.stats.bookingsToday },
    {
      label: "Revenue (7d)",
      value: `$${overview.stats.revenue7d.total.toLocaleString()}`,
    },
    {
      label: "Open tasks",
      value: overview.stats.openTasks,
      badge:
        overview.stats.overdueTasks > 0
          ? { text: `${overview.stats.overdueTasks} overdue`, variant: "overdue" as const }
          : undefined,
    },
  ];

  const funnelStages = [
    { name: "Inquiry", count: overview.funnel.inquiry },
    { name: "Qualified", count: overview.funnel.qualified },
    { name: "Booked", count: overview.funnel.booked },
    { name: "Purchased", count: overview.funnel.purchased },
    { name: "Completed", count: overview.funnel.completed },
  ];

  const totalApprovals = overview.stats.pendingApprovals;

  return (
    <div
      style={{
        maxWidth: "64rem",
        margin: "0 auto",
        padding: "48px",
        background: "var(--sw-base)",
        minHeight: "100vh",
      }}
      className="px-6 md:px-12"
    >
      {/* Header */}
      <DashboardHeader overview={overview} />

      {/* First Run Banner */}
      {isFirstRun && (
        <div style={{ marginTop: "32px" }}>
          <FirstRunBanner onDismiss={dismissBanner} />
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ marginTop: "48px" }}>
        <StatCardGrid stats={stats} />
      </div>

      {/* Action Zone */}
      <div
        style={{ marginTop: "48px", display: "grid", gap: "24px" }}
        className="grid-cols-1 lg:grid-cols-[1fr_1fr]"
      >
        {/* Needs Your Attention */}
        <div>
          <SectionLabel>Needs Your Attention</SectionLabel>
          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {overview.approvals.length === 0 ? (
              <div
                style={{
                  background: "var(--sw-surface-raised)",
                  border: "1px solid var(--sw-border)",
                  borderRadius: "12px",
                  padding: "24px",
                  textAlign: "center",
                }}
              >
                <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", margin: 0 }}>
                  All caught up
                </p>
              </div>
            ) : (
              <>
                {overview.approvals.map((approval) => (
                  <ActionCard
                    key={approval.id}
                    summary={approval.summary}
                    context={CONSEQUENCE[approval.riskCategory] ?? CONSEQUENCE.medium}
                    createdAt={approval.createdAt}
                    actions={[
                      {
                        label: respondingId === approval.id ? "Approving..." : "Approve",
                        variant: "primary",
                        onClick: () => {
                          setRespondingId(approval.id);
                          respondMutation.mutate({
                            approvalId: approval.id,
                            action: "approve",
                            bindingHash: approval.bindingHash,
                          });
                        },
                        loading: respondingId === approval.id && respondMutation.isPending,
                        disabled: respondingId === approval.id,
                      },
                      {
                        label: respondingId === approval.id ? "Declining..." : "Not now",
                        variant: "secondary",
                        onClick: () => {
                          setRespondingId(approval.id);
                          respondMutation.mutate({
                            approvalId: approval.id,
                            action: "reject",
                            bindingHash: approval.bindingHash,
                          });
                        },
                        loading: respondingId === approval.id && respondMutation.isPending,
                        disabled: respondingId === approval.id,
                      },
                    ]}
                  />
                ))}
                {totalApprovals > 3 && (
                  <Link
                    href="/decide"
                    style={{ fontSize: "14px", color: "var(--sw-accent)", textDecoration: "none" }}
                  >
                    View all {totalApprovals} →
                  </Link>
                )}
              </>
            )}
          </div>
        </div>

        {/* Today's Bookings */}
        <BookingPreview bookings={overview.bookings} />
      </div>

      {/* Funnel Snapshot */}
      <div style={{ marginTop: "48px" }}>
        <FunnelStrip stages={funnelStages} />
      </div>

      {/* Revenue + Tasks row */}
      <div
        style={{ marginTop: "48px", display: "grid", gap: "24px" }}
        className={overview.tasks.length > 0 ? "grid-cols-1 lg:grid-cols-[1fr_1fr]" : ""}
      >
        <RevenueSummary
          total={overview.revenue.total}
          count={overview.revenue.count}
          topSource={overview.revenue.topSource}
        />
        <OwnerTaskList tasks={overview.tasks} onComplete={handleTaskComplete} />
      </div>

      {/* Activity Feed */}
      <div style={{ marginTop: "48px" }}>
        <ActivityFeed events={overview.activity} />
      </div>
    </div>
  );
}
