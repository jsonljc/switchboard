import { cn } from "@/lib/utils";

interface TrustBarProps {
  score: number;
  delta?: number;
  className?: string;
}

export function TrustBar({ score, delta, className }: TrustBarProps) {
  const filledCount = Math.round((score / 100) * 10);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="Trust score"
        className="flex gap-0.5"
      >
        {Array.from({ length: 10 }, (_, i) => {
          const isFilled = i < filledCount;
          return (
            <div
              key={i}
              data-testid={`segment-${i}`}
              data-segment={i}
              data-filled={isFilled}
              className={cn(
                "w-2.5 h-4 border border-border",
                isFilled ? "bg-foreground" : "bg-transparent",
              )}
            />
          );
        })}
      </div>
      <span className="font-mono text-sm tabular-nums">{score}</span>
      {delta !== undefined && delta !== 0 && (
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            delta > 0 ? "text-positive" : "text-negative",
          )}
        >
          {delta > 0 ? "+" : ""}
          {delta}
        </span>
      )}
    </div>
  );
}
