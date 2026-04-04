"use client";

import { cn } from "@/lib/utils";

function getAutonomyLevel(score: number): "supervised" | "guided" | "autonomous" {
  if (score < 40) return "supervised";
  if (score < 70) return "guided";
  return "autonomous";
}

const LEVEL_STYLES = {
  supervised: "bg-negative/10 text-negative",
  guided: "bg-caution/10 text-caution",
  autonomous: "bg-positive/10 text-positive",
} as const;

const LEVEL_LABELS = {
  supervised: "Supervised",
  guided: "Guided",
  autonomous: "Autonomous",
} as const;

export function TrustScoreBadge({
  score,
  size = "default",
}: {
  score: number;
  size?: "default" | "lg";
}) {
  const level = getAutonomyLevel(score);

  return (
    <div className={cn("flex items-center gap-2", size === "lg" && "gap-3")}>
      <span
        className={cn(
          "font-semibold tabular-nums",
          size === "default" ? "text-[15px]" : "text-[28px]",
          score >= 70 ? "text-positive" : score >= 40 ? "text-caution" : "text-negative",
        )}
      >
        {Math.round(score)}
      </span>
      <span
        className={cn(
          "px-2 py-0.5 rounded-md font-medium",
          size === "default" ? "text-[11px]" : "text-[12px]",
          LEVEL_STYLES[level],
        )}
      >
        {LEVEL_LABELS[level]}
      </span>
    </div>
  );
}
