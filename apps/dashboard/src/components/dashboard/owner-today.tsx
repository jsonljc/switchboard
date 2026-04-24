"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { useFirstRun } from "@/hooks/use-first-run";
import { useEntrancePlayed } from "@/hooks/use-entrance-played";
import { FadeIn } from "@/components/ui/fade-in";
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
import { useModuleStatus } from "@/hooks/use-module-status";
import { ModuleCards } from "@/components/dashboard/module-cards";
import { RecommendationBar } from "@/components/dashboard/recommendation-bar";
import { SynergyStrip } from "@/components/dashboard/synergy-strip";
import { EmergencyHaltButton } from "./emergency-halt-button";

export function OwnerToday() {
  const { data: session } = useSession();
  const { data: overview, isLoading, isError } = useDashboardOverview();
  const { isFirstRun, dismissBanner } = useFirstRun();
  const { hasPlayed, markPlayed } = useEntrancePlayed();
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { data: modules } = useModuleStatus();

  const animate = !hasPlayed;

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

  useEffect(() => {
    if (hasPlayed || !overview) return;
    const timer = setTimeout(() => markPlayed(), 1200);
    return () => clearTimeout(timer);
  }, [hasPlayed, overview, markPlayed]);

  if (isError) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
    return (
      <div className="dashboard-frame">
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "28px",
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
      <div className="dashboard-frame">
        <div
          style={{
            height: "32px",
            background: "var(--sw-surface)",
            borderRadius: "8px",
            width: "200px",
            marginBottom: "48px",
          }}
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
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
      isRevenue: true,
    },
    {
      label: "Open tasks",
      value: overview.stats.openTasks,
      badge:
        overview.stats.overdueTasks > 0
          ? { text: `${overview.stats.overdueTasks} overdue`, variant: "overdue" as const }
          : undefined,
    },
  ].map((stat, i) => ({
    ...stat,
    animateCountUp: animate,
    countUpDelay: animate ? i * 60 : 0,
  }));

  const funnelStages = [
    { name: "Inquiry", count: overview.funnel.inquiry },
    { name: "Qualified", count: overview.funnel.qualified },
    { name: "Booked", count: overview.funnel.booked },
    { name: "Purchased", count: overview.funnel.purchased },
    { name: "Completed", count: overview.funnel.completed },
  ];

  const totalApprovals = overview.stats.pendingApprovals;

  const approvalsSection = (
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
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              style={{ margin: "0 auto 8px", display: "block" }}
            >
              <path
                d="M4 10l4 4 8-8"
                stroke="var(--sw-text-muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
                riskCategory={approval.riskCategory as "high" | "medium" | "low"}
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
  );

  const activitySection = <ActivityFeed events={overview.activity} animate={animate} />;

  return (
    <div className="dashboard-frame">
      {/* Wave 1: Header */}
      <FadeIn delay={animate ? 0 : 0} translateY={animate ? 8 : 0}>
        <DashboardHeader overview={overview} />
      </FadeIn>

      {/* First Run Banner */}
      {isFirstRun && (
        <div style={{ marginTop: "32px" }}>
          <FirstRunBanner onDismiss={dismissBanner} />
        </div>
      )}

      {/* Emergency Halt */}
      <div style={{ marginTop: "24px" }}>
        <EmergencyHaltButton />
      </div>

      {/* Module Control Center */}
      {modules && (
        <FadeIn delay={animate ? 100 : 0} translateY={animate ? 8 : 0}>
          <div style={{ marginTop: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <ModuleCards modules={modules} />
            <RecommendationBar modules={modules} />
            <SynergyStrip modules={modules} />
          </div>
        </FadeIn>
      )}

      {/* Wave 2: Stat Strip */}
      <FadeIn delay={animate ? 200 : 0} translateY={animate ? 8 : 0}>
        <div style={{ marginTop: "48px" }}>
          <StatCardGrid stats={stats} />
        </div>
      </FadeIn>

      {/* Wave 3: Content pairs */}
      <FadeIn delay={animate ? 400 : 0} translateY={animate ? 8 : 0}>
        <div className="dashboard-content-grid" style={{ marginTop: "32px" }}>
          <div
            className="dashboard-main"
            style={{ display: "flex", flexDirection: "column", gap: "32px" }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: "24px" }}>
              {approvalsSection}
              <BookingPreview bookings={overview.bookings} />
            </div>

            <FunnelStrip stages={funnelStages} animate={animate} />

            <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: "24px" }}>
              <RevenueSummary
                total={overview.revenue.total}
                count={overview.revenue.count}
                topSource={overview.revenue.topSource}
                dailyBreakdown={(overview.revenue as { dailyBreakdown?: number[] }).dailyBreakdown}
                animate={animate}
              />
              <OwnerTaskList tasks={overview.tasks} onComplete={handleTaskComplete} />
            </div>
          </div>

          <div className="dashboard-rail">
            <FadeIn delay={animate ? 600 : 0} translateY={animate ? 8 : 0}>
              {activitySection}
            </FadeIn>
          </div>
        </div>
      </FadeIn>

      {/* Activity inline — visible below 1440px */}
      <div className="dashboard-activity-inline" style={{ marginTop: "32px" }}>
        <FadeIn delay={animate ? 600 : 0} translateY={animate ? 8 : 0}>
          {activitySection}
        </FadeIn>
      </div>
    </div>
  );
}
