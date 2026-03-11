"use client";

import { cn } from "@/lib/utils";
import type { RevGrowthDigest } from "@/lib/api-client";

interface DigestViewerProps {
  digest: RevGrowthDigest | null;
}

const OUTCOME_COLORS: Record<string, string> = {
  IMPROVED: "bg-positive/15 text-positive-foreground",
  NO_CHANGE: "bg-muted text-muted-foreground",
  REGRESSED: "bg-destructive/15 text-destructive",
  PENDING: "bg-caution/15 text-caution-foreground",
  MEASURING: "bg-caution/15 text-caution-foreground",
  INCONCLUSIVE: "bg-muted text-muted-foreground",
};

export function DigestViewer({ digest }: DigestViewerProps) {
  if (!digest) {
    return (
      <div className="text-[13px] text-muted-foreground py-4">
        No weekly digest available yet. Run a diagnostic first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headline */}
      <h3 className="text-[15px] font-semibold text-foreground">{digest.headline}</h3>

      {/* Summary */}
      <p className="text-[13px] text-muted-foreground leading-relaxed">{digest.summary}</p>

      {/* Constraint history chips */}
      {digest.constraintHistory.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {digest.constraintHistory.map((ch, i) => (
            <span
              key={i}
              className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full"
            >
              {ch.type}: {ch.score}
            </span>
          ))}
        </div>
      )}

      {/* Outcome badges */}
      {digest.outcomeHighlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {digest.outcomeHighlights.map((oh, i) => (
            <span
              key={i}
              className={cn(
                "text-[10px] font-medium px-2 py-0.5 rounded-full",
                OUTCOME_COLORS[oh.outcomeStatus] ?? "bg-muted text-muted-foreground",
              )}
            >
              {oh.actionType}: {oh.outcomeStatus}
            </span>
          ))}
        </div>
      )}

      {/* Generated date */}
      <p className="text-[10px] text-muted-foreground/60">
        Generated {new Date(digest.generatedAt).toLocaleDateString()}
      </p>
    </div>
  );
}
