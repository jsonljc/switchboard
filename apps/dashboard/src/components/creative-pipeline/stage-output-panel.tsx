"use client";

import { TrendOutput } from "./trend-output";
import { HookOutput } from "./hook-output";
import { ScriptOutput } from "./script-output";
import { StoryboardOutputRenderer } from "./storyboard-output";
import { ProductionOutput } from "./production-output";

interface StageOutputPanelProps {
  stageName: string;
  output: unknown;
}

const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
};

export function StageOutputPanel({ stageName, output }: StageOutputPanelProps) {
  if (!output) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[13px] text-muted-foreground">
          No output yet for {STAGE_LABELS[stageName] ?? stageName}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-[15px] font-medium mb-4">
        Stage Output: {STAGE_LABELS[stageName] ?? stageName}
      </h3>
      {stageName === "trends" && <TrendOutput output={output} />}
      {stageName === "hooks" && <HookOutput output={output} />}
      {stageName === "scripts" && <ScriptOutput output={output} />}
      {stageName === "storyboard" && <StoryboardOutputRenderer output={output} />}
      {stageName === "production" && <ProductionOutput output={output} />}
    </div>
  );
}
