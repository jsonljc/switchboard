"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CreativeJobSummary } from "@/lib/api-client";

const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
  complete: "Complete",
};

function getStatusInfo(job: CreativeJobSummary): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (job.stoppedAt) return { label: "Stopped", variant: "secondary" };
  if (job.currentStage === "complete") return { label: "Complete", variant: "default" };
  return {
    label: `Running: ${STAGE_LABELS[job.currentStage] ?? job.currentStage}`,
    variant: "outline",
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface CreativeJobCardProps {
  job: CreativeJobSummary;
  deploymentId: string;
}

export function CreativeJobCard({ job, deploymentId }: CreativeJobCardProps) {
  const status = getStatusInfo(job);
  return (
    <Link
      href={`/deployments/${deploymentId}/creative-jobs/${job.id}`}
      className="flex items-center justify-between py-3 px-4 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center gap-3">
        <Badge variant={status.variant} className="text-[11px]">
          {status.label}
        </Badge>
        <span className="text-[13px] text-muted-foreground truncate max-w-[200px]">
          {job.productDescription.slice(0, 60)}
          {job.productDescription.length > 60 ? "..." : ""}
        </span>
      </div>
      <span className="text-[12px] text-muted-foreground shrink-0">{timeAgo(job.createdAt)}</span>
    </Link>
  );
}
