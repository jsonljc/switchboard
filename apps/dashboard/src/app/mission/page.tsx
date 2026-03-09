"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { useApprovalCount, useApprovals } from "@/hooks/use-approvals";
import { useAgentRoster, useAgentState } from "@/hooks/use-agents";
import { useSpend } from "@/hooks/use-spend";
import { useAudit } from "@/hooks/use-audit";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useState } from "react";

/* ─── Helpers ─── */
function formatRelative(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ─── Status dot ─── */
function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-[7px] w-[7px] rounded-full shrink-0",
        active
          ? "bg-agent-attention animate-pulse"
          : "bg-agent-active",
      )}
    />
  );
}

/* ─── Work card ─── */
function WorkCard({
  agentName,
  description,
  context,
  timestamp,
}: {
  agentName: string;
  description: string;
  context: string;
  timestamp: string;
}) {
  return (
    <div className="flex gap-4 py-4 border-b border-border/50 last:border-0 group">
      {/* Agent mark */}
      <div className="shrink-0 mt-0.5">
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {agentName.slice(0, 2)}
          </span>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-foreground leading-snug">{description}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="section-label">{context}</span>
          <span className="text-muted-foreground/40">·</span>
          <time className="text-[11px] text-muted-foreground">{timestamp}</time>
        </div>
      </div>
    </div>
  );
}

/* ─── Approval card (inline) ─── */
function InlineApprovalCard({
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
    <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Waiting on you</p>
        <p className="text-[14.5px] text-foreground leading-relaxed">{approval.summary}</p>
      </div>
      <div className="flex items-center gap-2">
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
          className="px-4 py-2 rounded-lg text-[13px] font-medium border border-border text-muted-foreground hover:text-foreground hover:border-border-subtle transition-colors disabled:opacity-50"
        >
          Decline
        </button>
        <Link
          href={`/approvals`}
          className="ml-auto text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          See all →
        </Link>
      </div>
    </div>
  );
}

/* ─── Outcome tile ─── */
function OutcomeTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex-1 py-6 px-6 first:pl-0 border-r border-border/50 last:border-0 last:pr-0">
      <p className="text-[28px] font-light text-foreground leading-none tracking-tight">
        {value}
      </p>
      <p className="text-[12px] text-muted-foreground mt-2 leading-snug">{label}</p>
    </div>
  );
}

export default function MissionControlPage() {
  const { status, data: session } = useSession();
  const queryClient = useQueryClient();

  const pendingCount = useApprovalCount();
  const { data: approvalsData } = useApprovals();
  const { data: stateData } = useAgentState();
  const { data: rosterData, isLoading: rosterLoading } = useAgentRoster();
  const { data: summaryData, isLoading: spendLoading } = useSpend();
  const { data: auditData, isLoading: auditLoading } = useAudit({ limit: 6 });

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

  const hasErrors = stateData?.states?.some((s) => s.activityStatus === "error") ?? false;
  const needsAttention = pendingCount > 0 || hasErrors;
  const primaryOperator = rosterData?.roster?.find((a) => a.agentRole === "primary_operator");
  const operatorName = primaryOperator?.displayName ?? "Your assistant";

  const approvals = approvalsData?.approvals?.slice(0, 3) ?? [];
  const entries = auditData?.entries ?? [];

  // Build work cards from agent states
  const activeAgents = stateData?.states?.filter(
    (s) => s.activityStatus === "working" || s.activityStatus === "analyzing",
  ) ?? [];

  if (status === "loading" || rosterLoading) {
    return (
      <div className="page-width py-10 md:py-14 space-y-14">
        <div className="space-y-2">
          <Skeleton className="h-6 w-72" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-width py-10 md:py-14 space-y-14">

      {/* ── Zone 1: Status Hero ── */}
      <section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusDot active={needsAttention} />
            <h1 className="text-[17px] font-medium text-foreground tracking-tight">
              {needsAttention
                ? `${operatorName} needs your attention`
                : `${operatorName} is active`}
            </h1>
            {!needsAttention && (
              <span className="text-[14px] text-muted-foreground hidden sm:inline">
                · working in the background
              </span>
            )}
          </div>
          <Link
            href="/team"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View team →
          </Link>
        </div>
      </section>

      {/* ── Zone 2: Active Work + Needs Attention ── */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-12 lg:gap-16">

        {/* Active Work */}
        <div>
          <h2 className="section-label mb-5">Active work</h2>

          {activeAgents.length === 0 && entries.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              {auditLoading
                ? "Loading…"
                : "Your team is caught up. Nothing active right now."}
            </p>
          ) : null}

          {/* Active agent states */}
          {activeAgents.map((state) => {
            const agent = rosterData?.roster?.find((a) => a.id === state.agentRosterId);
            return (
              <WorkCard
                key={state.id}
                agentName={agent?.displayName ?? operatorName}
                description={state.currentTask ?? "Working…"}
                context={(agent?.agentRole ?? "agent").replace(/_/g, " ")}
                timestamp="Just now"
              />
            );
          })}

          {/* Recent audit entries as work cards */}
          {activeAgents.length === 0 &&
            entries.slice(0, 4).map((entry) => (
              <WorkCard
                key={entry.id}
                agentName={operatorName}
                description={entry.summary}
                context={entry.eventType.replace(/\./g, " ").replace(/_/g, " ")}
                timestamp={formatRelative(entry.timestamp)}
              />
            ))}

          {entries.length > 4 && (
            <Link
              href="/activity"
              className="inline-block mt-4 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              See all activity ({entries.length}) →
            </Link>
          )}
        </div>

        {/* Needs Attention */}
        <div>
          <h2 className="section-label mb-5">Needs your input</h2>

          {approvals.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-surface-raised px-5 py-8 text-center">
              <p className="text-[14px] text-foreground font-medium">You&apos;re all caught up.</p>
              <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                {operatorName} will reach out if anything needs your input.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.map((approval) => (
                <InlineApprovalCard
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

      {/* ── Zone 3: Outcomes ── */}
      <section>
        <h2 className="section-label mb-4">Performance</h2>
        <div className="flex items-stretch border border-border/60 rounded-xl bg-surface overflow-hidden">
          {spendLoading ? (
            <div className="flex gap-8 p-6">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          ) : (
            <>
              <OutcomeTile
                value={formatMetric(summaryData?.spend.last30Days, "currency")}
                label="Meta spend (30d)"
              />
              <OutcomeTile
                value={summaryData?.outcomes.leads30d ?? "–"}
                label="Leads captured (30d)"
              />
              <OutcomeTile
                value={summaryData?.outcomes.bookings30d ?? "0"}
                label="Bookings created (30d)"
              />
              <OutcomeTile
                value={pendingCount > 0 ? pendingCount : "0"}
                label={
                  summaryData?.spend.connectionStatus === "connected"
                    ? `Decisions waiting · refreshed ${formatRelative(summaryData.spend.freshness.fetchedAt ?? new Date().toISOString())}`
                    : "Decisions waiting"
                }
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function formatMetric(value: number | null | undefined, kind: "currency" | "count"): string {
  if (value == null) return "--";
  if (kind === "currency") {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return value.toLocaleString();
}
