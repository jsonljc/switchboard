"use client";

import type { PipelineSnapshot } from "@/hooks/use-pipeline";

const FUNNEL_STAGES = ["interested", "qualified", "quoted", "booked", "showed", "won"] as const;

const STAGE_LABELS: Record<string, string> = {
  interested: "Interested",
  qualified: "Qualified",
  quoted: "Quoted",
  booked: "Booked",
  showed: "Showed",
  won: "Won",
};

const STAGE_COLORS: Record<string, string> = {
  interested: "bg-blue-400/70",
  qualified: "bg-blue-500/70",
  quoted: "bg-blue-600/70",
  booked: "bg-blue-700/70",
  showed: "bg-blue-800/70",
  won: "bg-blue-900/80",
};

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function SkeletonBars() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div
            className="h-6 rounded bg-muted animate-pulse"
            style={{ width: `${100 - i * 12}%`, minWidth: "8%" }}
          />
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

interface PipelineFunnelProps {
  data: PipelineSnapshot | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function PipelineFunnel({ data, isLoading, isError }: PipelineFunnelProps) {
  if (isError) return null;

  if (isLoading) {
    return (
      <section>
        <h2 className="section-label mb-3">Your pipeline</h2>
        <div className="rounded-xl border border-border/60 bg-surface p-5">
          <SkeletonBars />
        </div>
      </section>
    );
  }

  if (!data || data.stages.length === 0) {
    return (
      <section>
        <h2 className="section-label mb-3">Your pipeline</h2>
        <div className="rounded-xl border border-border/60 bg-surface-raised px-6 py-6 text-center">
          <p className="text-[14px] text-foreground font-medium">No leads in your pipeline yet</p>
        </div>
      </section>
    );
  }

  const stageMap = new Map(data.stages.map((s) => [s.stage, s]));
  const maxCount = Math.max(...FUNNEL_STAGES.map((s) => stageMap.get(s)?.count ?? 0), 1);

  const lost = stageMap.get("lost");
  const nurturing = stageMap.get("nurturing");

  return (
    <section>
      <h2 className="section-label mb-3">Your pipeline</h2>
      <div className="rounded-xl border border-border/60 bg-surface p-5 space-y-2.5">
        {FUNNEL_STAGES.map((stage) => {
          const entry = stageMap.get(stage);
          const count = entry?.count ?? 0;
          const value = entry?.totalValue ?? 0;
          const widthPct = Math.max((count / maxCount) * 100, 8);

          return (
            <div key={stage} className="flex items-center gap-3">
              <div
                className={`h-6 rounded ${STAGE_COLORS[stage] ?? "bg-blue-500/70"}`}
                style={{ width: `${widthPct}%` }}
              />
              <span className="text-[12.5px] text-muted-foreground whitespace-nowrap min-w-[70px]">
                {STAGE_LABELS[stage] ?? stage}
              </span>
              <span className="text-[13px] text-foreground font-medium tabular-nums">{count}</span>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {formatCurrency(value)}
              </span>
            </div>
          );
        })}

        {(lost || nurturing) && (
          <p className="text-[12px] text-muted-foreground pt-1">
            {[lost && `${lost.count} lost`, nurturing && `${nurturing.count} nurturing`]
              .filter(Boolean)
              .join(" \u00b7 ")}
          </p>
        )}
      </div>
    </section>
  );
}
