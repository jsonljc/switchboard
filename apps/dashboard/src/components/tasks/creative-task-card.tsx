"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { MarketplaceTask } from "@/lib/api-client";
import { TaskCard } from "./task-card";

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

interface CreativeTaskCardProps {
  task: MarketplaceTask;
  onApprove?: (task: MarketplaceTask) => void;
  onReject?: (task: MarketplaceTask) => void;
}

function parseCreativeInput(input: Record<string, unknown>): {
  productDescription: string;
  platforms: string[];
} | null {
  const desc = input.productDescription;
  const plats = input.platforms;
  if (typeof desc !== "string" || !Array.isArray(plats)) return null;
  return { productDescription: desc, platforms: plats as string[] };
}

export function CreativeTaskCard({ task, onApprove, onReject }: CreativeTaskCardProps) {
  const parsed = parseCreativeInput(task.input);
  if (!parsed) {
    return <TaskCard task={task} onApprove={onApprove} onReject={onReject} />;
  }

  const isReviewable = task.status === "awaiting_review" && task.output;

  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[14px] text-foreground font-medium">Creative Strategy</p>
            <Badge variant="outline" className="text-[11px]">
              Pipeline
            </Badge>
          </div>
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

      {/* Product description */}
      <p className="text-[13px] text-muted-foreground line-clamp-2">{parsed.productDescription}</p>

      {/* Platforms */}
      <div className="flex gap-1.5">
        {parsed.platforms.map((p) => (
          <Badge key={p} variant="secondary" className="text-[11px] capitalize">
            {p}
          </Badge>
        ))}
      </div>

      {/* View pipeline link */}
      <Link
        href={`/deployments/${task.deploymentId}`}
        className="inline-flex items-center gap-1 text-[13px] text-blue-600 hover:text-blue-700 transition-colors"
      >
        View Pipeline
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>

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
