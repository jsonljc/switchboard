interface FunnelStage {
  label: string;
  count: number;
  rate: string;
}

interface FunnelBarsProps {
  stages: FunnelStage[];
  maxCount: number;
}

export function FunnelBars({ stages, maxCount }: FunnelBarsProps) {
  return (
    <div className="space-y-3">
      {stages.map((stage) => (
        <div key={stage.label} className="flex items-center gap-4">
          <span className="w-24 text-sm font-medium">{stage.label}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${maxCount > 0 ? (stage.count / maxCount) * 100 : 0}%` }}
            />
          </div>
          <span className="w-24 text-right text-sm tabular-nums">
            {stage.count} {stage.rate !== "—" ? `(${stage.rate})` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
