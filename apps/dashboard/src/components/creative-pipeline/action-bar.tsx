"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useApproveStage } from "@/hooks/use-creative-pipeline";
import { TierSelection } from "./tier-selection";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production"] as const;
const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
};

function getNextStageLabel(currentStage: string): string {
  const idx = STAGES.indexOf(currentStage as (typeof STAGES)[number]);
  if (idx === -1 || idx >= STAGES.length - 1) return "Complete";
  return STAGE_LABELS[STAGES[idx + 1]] ?? "Next";
}

interface ActionBarProps {
  jobId: string;
  currentStage: string;
  stoppedAt: string | null;
}

export function ActionBar({ jobId, currentStage, stoppedAt }: ActionBarProps) {
  const { toast } = useToast();
  const approveMutation = useApproveStage();
  const [confirmStop, setConfirmStop] = useState(false);

  // Hide when job is complete or stopped
  if (currentStage === "complete" || stoppedAt) return null;

  // When current stage is storyboard (Stage 4), show tier selection instead of normal buttons
  if (currentStage === "storyboard") {
    return (
      <div className="sticky bottom-0 bg-background border-t border-border p-4">
        <TierSelection jobId={jobId} />
      </div>
    );
  }

  const handleApprove = () => {
    approveMutation.mutate(
      { jobId, action: "continue" },
      {
        onSuccess: () => {
          toast({ title: "Stage approved", description: "Pipeline continuing to next stage." });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update pipeline. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleStop = () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    approveMutation.mutate(
      { jobId, action: "stop" },
      {
        onSuccess: () => {
          toast({ title: "Pipeline stopped" });
          setConfirmStop(false);
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update pipeline. Please try again.",
            variant: "destructive",
          });
          setConfirmStop(false);
        },
      },
    );
  };

  return (
    <div className="sticky bottom-0 bg-background border-t border-border p-4 flex items-center justify-end gap-3">
      <Button
        variant="destructive"
        size="sm"
        onClick={handleStop}
        disabled={approveMutation.isPending}
      >
        {confirmStop ? "Are you sure?" : "Stop Pipeline"}
      </Button>
      <Button size="sm" onClick={handleApprove} disabled={approveMutation.isPending}>
        {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Approve & Continue to {getNextStageLabel(currentStage)}
      </Button>
    </div>
  );
}
