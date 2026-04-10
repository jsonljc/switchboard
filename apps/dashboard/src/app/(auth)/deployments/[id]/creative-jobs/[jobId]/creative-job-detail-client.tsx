"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCreativeJob } from "@/hooks/use-creative-pipeline";
import { PipelineStepper } from "@/components/creative-pipeline/pipeline-stepper";
import { StageOutputPanel } from "@/components/creative-pipeline/stage-output-panel";
import { ActionBar } from "@/components/creative-pipeline/action-bar";
import type { CreativeJobSummary } from "@/lib/api-client";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production"] as const;

function getLatestCompletedStage(job: CreativeJobSummary): string {
  if (job.currentStage === "complete") return "production";
  const currentIdx = STAGES.indexOf(job.currentStage as (typeof STAGES)[number]);
  if (currentIdx <= 0) return STAGES[0];
  return STAGES[currentIdx - 1];
}

function getStatusInfo(job: CreativeJobSummary): {
  label: string;
  className: string;
} {
  if (job.stoppedAt) return { label: "Stopped", className: "bg-gray-500/10 text-gray-600" };
  if (job.currentStage === "complete")
    return { label: "Complete", className: "bg-green-500/10 text-green-600" };
  return { label: "Running", className: "bg-blue-500/10 text-blue-600" };
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

interface CreativeJobDetailClientProps {
  deploymentId: string;
  initialJob: CreativeJobSummary;
}

export function CreativeJobDetailClient({
  deploymentId,
  initialJob,
}: CreativeJobDetailClientProps) {
  const router = useRouter();
  const { data: job } = useCreativeJob(initialJob.id);
  const currentJob = job ?? initialJob;

  const [selectedStage, setSelectedStage] = useState(() => getLatestCompletedStage(currentJob));

  const status = getStatusInfo(currentJob);
  const stageOutput = (currentJob.stageOutputs as Record<string, unknown>)[selectedStage];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push(`/deployments/${deploymentId}`)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to deployment
      </button>

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          Creative Job #{currentJob.id.slice(0, 8)}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <Badge className={`text-[11px] ${status.className}`}>{status.label}</Badge>
          <span className="text-[13px] text-muted-foreground">{timeAgo(currentJob.createdAt)}</span>
        </div>
      </div>

      {/* Pipeline Stepper */}
      <PipelineStepper
        currentStage={currentJob.currentStage}
        stoppedAt={currentJob.stoppedAt}
        onStageClick={setSelectedStage}
        selectedStage={selectedStage}
      />

      {/* Stage Output */}
      <StageOutputPanel stageName={selectedStage} output={stageOutput} />

      {/* Action Bar */}
      <ActionBar
        jobId={currentJob.id}
        currentStage={currentJob.currentStage}
        stoppedAt={currentJob.stoppedAt}
      />
    </div>
  );
}
