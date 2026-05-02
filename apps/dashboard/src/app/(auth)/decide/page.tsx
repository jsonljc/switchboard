"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { RespondDialog } from "@/components/approvals/respond-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useApprovals } from "@/hooks/use-approvals";
import { useApprovalAction } from "@/hooks/use-approval-action";
import { useAudit } from "@/hooks/use-audit";
import { useTasks, useReviewTask } from "@/hooks/use-marketplace";
import { TaskCard } from "@/components/tasks/task-card";
import { CreativeTaskCard } from "@/components/tasks/creative-task-card";
import { TaskReviewDialog } from "@/components/tasks/task-review-dialog";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { CONSEQUENCE } from "@/lib/approval-constants";
import { useToast } from "@/components/ui/use-toast";
import type { MarketplaceTask } from "@/lib/api-client";

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
  const { status } = useSession();
  const { data: approvalsData, isLoading } = useApprovals();
  const { data: historyData } = useAudit({ limit: 50 });
  const { data: allTaskData, isLoading: tasksLoading } = useTasks();
  const reviewTask = useReviewTask();
  const [tab, setTab] = useState<"pending" | "history" | "tasks">("pending");
  const { toast } = useToast();

  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    action: "approved" | "rejected";
    task: MarketplaceTask;
  } | null>(null);

  const [dialog, setDialog] = useState<{
    open: boolean;
    action: "approve" | "reject";
    approval: { id: string; summary: string; bindingHash: string; riskCategory: string };
  } | null>(null);

  const approvalAction = useApprovalAction(dialog?.approval.id ?? "");

  const handleConfirmRespond = async () => {
    if (!dialog) return;
    try {
      if (dialog.action === "approve") {
        await approvalAction.approve(dialog.approval.bindingHash);
      } else {
        await approvalAction.reject(dialog.approval.bindingHash);
      }
      toast({
        title: dialog.action === "approve" ? "Approved" : "Declined",
        description:
          dialog.action === "approve" ? "The action will proceed." : "The action has been blocked.",
      });
      setDialog(null);
    } catch {
      toast({
        title: "Something went wrong",
        description: "Try again or check your connection.",
        variant: "destructive",
      });
    }
  };

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

  const allTasks = allTaskData ?? [];
  const reviewableTasks = allTasks.filter((t) => t.status === "awaiting_review" && t.output);
  const reviewableCount = reviewableTasks.length;

  const handleTaskReview = async (result: "approved" | "rejected", reviewResult?: string) => {
    if (!taskDialog) return;
    try {
      await reviewTask.mutateAsync({
        taskId: taskDialog.task.id,
        result,
        reviewResult,
      });
      toast({
        title: result === "approved" ? "Approved" : "Rejected",
        description:
          result === "approved"
            ? "Performance score updated. Agent earns more autonomy."
            : "Performance score updated. Agent requires more oversight.",
      });
      setTaskDialog(null);
    } catch (err) {
      toast({
        title: "Review failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

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
            { key: "tasks", label: `Tasks${reviewableCount > 0 ? ` · ${reviewableCount}` : ""}` },
            { key: "history", label: "History" },
          ] as { key: "pending" | "history" | "tasks"; label: string }[]
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

      {tab === "tasks" && (
        <div className="space-y-4">
          {tasksLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))
          ) : reviewableTasks.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[15px] text-foreground font-medium">Nothing to review.</p>
              <p className="text-[14px] text-muted-foreground mt-1.5">
                Agent outputs will appear here when they need your approval.
              </p>
            </div>
          ) : (
            reviewableTasks.map((task) => {
              const Card = task.category === "creative_strategy" ? CreativeTaskCard : TaskCard;
              return (
                <Card
                  key={task.id}
                  task={task}
                  onApprove={(t) => setTaskDialog({ open: true, action: "approved", task: t })}
                  onReject={(t) => setTaskDialog({ open: true, action: "rejected", task: t })}
                />
              );
            })
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
          isLoading={approvalAction.isPending}
          onConfirm={handleConfirmRespond}
        />
      )}

      {taskDialog && (
        <TaskReviewDialog
          open={taskDialog.open}
          onClose={() => setTaskDialog(null)}
          action={taskDialog.action}
          taskCategory={taskDialog.task.category}
          isLoading={reviewTask.isPending}
          onConfirm={(reviewResult) => handleTaskReview(taskDialog.action, reviewResult)}
        />
      )}
    </div>
  );
}
