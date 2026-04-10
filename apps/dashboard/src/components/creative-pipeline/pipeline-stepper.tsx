"use client";

import { Check, Circle, Loader2, Square } from "lucide-react";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production"] as const;

const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
};

type StepState = "completed" | "current" | "pending" | "stopped";

function getStepState(stage: string, currentStage: string, stoppedAt: string | null): StepState {
  const stageIdx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const currentIdx = STAGES.indexOf(currentStage as (typeof STAGES)[number]);

  // "complete" means all stages done
  if (currentStage === "complete") return "completed";

  if (stoppedAt) {
    const stoppedIdx = STAGES.indexOf(stoppedAt as (typeof STAGES)[number]);
    if (stageIdx < stoppedIdx) return "completed";
    if (stageIdx === stoppedIdx) return "stopped";
    return "pending";
  }

  if (stageIdx < currentIdx) return "completed";
  if (stageIdx === currentIdx) return "current";
  return "pending";
}

interface PipelineStepperProps {
  currentStage: string;
  stoppedAt: string | null;
  onStageClick: (stage: string) => void;
  selectedStage: string;
}

export function PipelineStepper({
  currentStage,
  stoppedAt,
  onStageClick,
  selectedStage,
}: PipelineStepperProps) {
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((stage, i) => {
        const state = getStepState(stage, currentStage, stoppedAt);
        const isClickable = state === "completed";
        const isSelected = stage === selectedStage;

        return (
          <div key={stage} className="flex items-center">
            {/* Step */}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStageClick(stage)}
              className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg transition-colors ${
                isSelected ? "bg-muted" : ""
              } ${isClickable ? "cursor-pointer hover:bg-muted/50" : "cursor-default"}`}
            >
              {/* Icon */}
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center ${
                  state === "completed"
                    ? "bg-green-500/10 text-green-600"
                    : state === "current"
                      ? "bg-blue-500/10 text-blue-600"
                      : state === "stopped"
                        ? "bg-gray-500/10 text-gray-500"
                        : "bg-muted text-muted-foreground"
                }`}
              >
                {state === "completed" && <Check className="h-4 w-4" />}
                {state === "current" && <Loader2 className="h-4 w-4 animate-spin" />}
                {state === "stopped" && <Square className="h-3.5 w-3.5" />}
                {state === "pending" && <Circle className="h-4 w-4" />}
              </div>
              {/* Label */}
              <span
                className={`text-[11px] font-medium ${
                  state === "completed"
                    ? "text-green-600"
                    : state === "current"
                      ? "text-blue-600"
                      : "text-muted-foreground"
                }`}
              >
                {STAGE_LABELS[stage]}
              </span>
            </button>

            {/* Connector line */}
            {i < STAGES.length - 1 && (
              <div
                className={`h-0.5 w-6 ${
                  getStepState(STAGES[i + 1], currentStage, stoppedAt) !== "pending"
                    ? "bg-green-500/30"
                    : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
