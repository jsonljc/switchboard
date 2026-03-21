"use client";

interface FunnelStage {
  label: string;
  count: number;
}

interface FunnelChartProps {
  stages: FunnelStage[];
}

export function FunnelChart({ stages }: FunnelChartProps) {
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const widthPercent = Math.max(8, (stage.count / max) * 100);
        const prevCount = i > 0 ? stages[i - 1]!.count : null;
        const dropOff =
          prevCount != null && prevCount > 0
            ? Math.round(((prevCount - stage.count) / prevCount) * 100)
            : null;

        return (
          <div key={stage.label} className="flex items-center gap-3">
            <div className="w-24 text-right">
              <p className="text-[13px] text-muted-foreground">{stage.label}</p>
            </div>
            <div className="flex-1 flex items-center gap-3">
              <div
                className="h-8 rounded bg-positive/65 transition-all duration-500 flex items-center px-3"
                style={{ width: `${widthPercent}%` }}
              >
                <span className="text-[13px] font-medium text-foreground">{stage.count}</span>
              </div>
              {dropOff !== null && dropOff > 0 && (
                <span className="text-[11px] text-muted-foreground">-{dropOff}%</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
