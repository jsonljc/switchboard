"use client";

import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  label: string;
  score: number | null;
  confidence?: string;
  size?: number;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-positive-foreground";
  if (score >= 40) return "text-caution-foreground";
  return "text-destructive";
}

function strokeColor(score: number): string {
  if (score >= 70) return "stroke-positive";
  if (score >= 40) return "stroke-caution";
  return "stroke-destructive";
}

export function ScoreGauge({ label, score, confidence, size = 80 }: ScoreGaugeProps) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score !== null ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const offset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-muted/30"
            strokeWidth={4}
          />
          {/* Score arc */}
          {score !== null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              className={cn(strokeColor(score))}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 0.6s ease" }}
            />
          )}
        </svg>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "text-[18px] font-semibold",
              score !== null ? scoreColor(score) : "text-muted-foreground",
            )}
          >
            {score !== null ? score : "--"}
          </span>
        </div>
      </div>
      <p className="text-[11.5px] text-muted-foreground text-center leading-tight">{label}</p>
      {confidence && (
        <span className="text-[10px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded-full">
          {confidence}
        </span>
      )}
    </div>
  );
}
