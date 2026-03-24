"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RespondDialog } from "@/components/approvals/respond-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useApprovals } from "@/hooks/use-approvals";
import { useAudit } from "@/hooks/use-audit";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { CONSEQUENCE } from "@/lib/approval-constants";

const APPROVAL_EVENT_TYPES = ["action.approved", "action.rejected", "action.expired"];

/* ─── Approval card ─── */
function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: {
    id: string;
    summary: string;
    bindingHash: string;
    riskCategory: string;
    createdAt?: string;
  };
  onApprove: (id: string, bindingHash: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      {approval.createdAt && <p className="section-label">{formatRelative(approval.createdAt)}</p>}
      <p className="text-[15px] text-foreground leading-relaxed">{approval.summary}</p>
      <p className="text-[13px] text-muted-foreground italic leading-snug">
        {CONSEQUENCE[approval.riskCategory] ?? CONSEQUENCE.medium}
      </p>
      <div className="flex items-center gap-3 pt-1 border-t border-border/60">
        <button
          onClick={() => onApprove(approval.id, approval.bindingHash)}
          className="px-5 py-2.5 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity"
        >
          Approve
        </button>
        <button
          onClick={() => onReject(approval.id)}
          className="px-4 py-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/* ─── History item ─── */
function HistoryItem({
  summary,
  eventType,
  timestamp,
}: {
  summary: string;
  eventType: string;
  timestamp: string;
}) {
  const isApproved = eventType === "action.approved";
  const isRejected = eventType === "action.rejected";
  return (
    <div className="flex items-start gap-4 py-4 border-b border-border/50 last:border-0">
      <div
        className={cn(
          "mt-0.5 h-2 w-2 rounded-full shrink-0",
          isApproved ? "bg-positive" : isRejected ? "bg-negative" : "bg-agent-idle",
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-foreground leading-snug">{summary}</p>
        <p className="text-[12px] text-muted-foreground mt-0.5">{formatRelative(timestamp)}</p>
      </div>
    </div>
  );
}

export default function DecidePage() {
  const { data: session, status } = useSession();
  const { data: approvalsData, isLoading } = useApprovals();
  const { data: historyData } = useAudit({ limit: 50 });
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"pending" | "history">("pending");

  const [dialog, setDialog] = useState<{
    open: boolean;
    action: "approve" | "reject";
    approval: { id: string; summary: string; bindingHash: string; riskCategory: string };
  } | null>(null);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
      setDialog(null);
    },
  });

  if (status === "unauthenticated") redirect("/login");

  const handleApprove = (id: string, bindingHash: string) => {
    const approval = approvalsData?.approvals.find((a) => a.id === id);
    if (approval) {
      setDialog({
        open: true,
        action: "approve",
        approval: {
          id,
          summary: approval.summary,
          bindingHash,
          riskCategory: approval.riskCategory,
        },
      });
    }
  };

  const handleReject = (id: string) => {
    const approval = approvalsData?.approvals.find((a) => a.id === id);
    if (approval) {
      setDialog({
        open: true,
        action: "reject",
        approval: {
          id,
          summary: approval.summary,
          bindingHash: approval.bindingHash,
          riskCategory: approval.riskCategory,
        },
      });
    }
  };

  const historyEntries =
    historyData?.entries.filter((e) => APPROVAL_EVENT_TYPES.includes(e.eventType)) ?? [];

  const pendingCount = approvalsData?.approvals.length ?? 0;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Decide</h1>
        <p className="text-[14px] text-muted-foreground mt-1">Decisions only you can make.</p>
      </section>

      {/* Tab strip */}
      <div className="flex items-center gap-0 border-b border-border/60">
        {(
          [
            { key: "pending", label: `Pending${pendingCount > 0 ? ` · ${pendingCount}` : ""}` },
            { key: "history", label: "History" },
          ] as { key: "pending" | "history"; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast",
              tab === t.key
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {tab === "pending" && (
        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-36" />)
          ) : pendingCount === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[15px] text-foreground font-medium">Nothing waiting on you.</p>
              <p className="text-[14px] text-muted-foreground mt-1.5">
                Your assistant is running within the limits you set.
              </p>
            </div>
          ) : (
            approvalsData?.approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))
          )}
        </div>
      )}

      {tab === "history" && (
        <div>
          {historyEntries.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[14px] text-muted-foreground">No approval history yet.</p>
            </div>
          ) : (
            historyEntries.map((entry) => (
              <HistoryItem
                key={entry.id}
                summary={entry.summary}
                eventType={entry.eventType}
                timestamp={entry.timestamp}
              />
            ))
          )}
        </div>
      )}

      {dialog && (
        <RespondDialog
          open={dialog.open}
          onClose={() => setDialog(null)}
          action={dialog.action}
          approval={dialog.approval}
          isLoading={respondMutation.isPending}
          onConfirm={() =>
            respondMutation.mutate({
              approvalId: dialog.approval.id,
              action: dialog.action,
              bindingHash: dialog.approval.bindingHash,
            })
          }
        />
      )}
    </div>
  );
}
