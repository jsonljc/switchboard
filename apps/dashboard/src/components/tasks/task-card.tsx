"use client";

import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { MarketplaceTask } from "@/lib/api-client";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-caution/10 text-caution",
  awaiting_review: "bg-caution/10 text-caution",
  approved: "bg-positive/10 text-positive",
  rejected: "bg-negative/10 text-negative",
  completed: "bg-positive/10 text-positive",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  awaiting_review: "Awaiting Review",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

interface TaskCardProps {
  task: MarketplaceTask;
  onApprove?: (task: MarketplaceTask) => void;
  onReject?: (task: MarketplaceTask) => void;
}

export function TaskCard({ task, onApprove, onReject }: TaskCardProps) {
  const isReviewable = task.status === "awaiting_review" && task.output;

  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] text-foreground font-medium capitalize">{task.category} task</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {formatRelative(task.createdAt)}
          </p>
        </div>
        <span
          className={cn(
            "px-2 py-0.5 rounded-md text-[11px] font-medium",
            STATUS_STYLES[task.status] ?? STATUS_STYLES.pending,
          )}
        >
          {STATUS_LABELS[task.status] ?? task.status}
        </span>
      </div>

      {/* Input summary */}
      {task.input && Object.keys(task.input).length > 0 && (
        <div>
          <p className="section-label mb-1">Input</p>
          <p className="text-[13px] text-muted-foreground line-clamp-2">
            {typeof task.input === "object"
              ? JSON.stringify(task.input).slice(0, 200)
              : String(task.input)}
          </p>
        </div>
      )}

      {/* Output preview */}
      {task.output && (
        <div>
          <p className="section-label mb-1">Output</p>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-[13px] text-foreground whitespace-pre-wrap line-clamp-4">
              {typeof task.output === "object"
                ? JSON.stringify(task.output, null, 2).slice(0, 300)
                : String(task.output)}
            </p>
          </div>
        </div>
      )}

      {/* Acceptance criteria */}
      {task.acceptanceCriteria && (
        <p className="text-[12px] text-muted-foreground italic">
          Criteria: {task.acceptanceCriteria}
        </p>
      )}

      {/* Review actions */}
      {isReviewable && onApprove && onReject && (
        <div className="flex items-center gap-3 pt-2 border-t border-border/60">
          <button
            onClick={() => onApprove(task)}
            className="px-5 py-2.5 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity min-h-[44px]"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(task)}
            className="px-4 py-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            Reject
          </button>
        </div>
      )}

      {/* Review result */}
      {task.reviewResult && (
        <p className="text-[12px] text-muted-foreground">
          Review: {task.reviewResult}
          {task.reviewedAt && ` · ${formatRelative(task.reviewedAt)}`}
        </p>
      )}
    </div>
  );
}
