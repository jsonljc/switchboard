"use client";

import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  comparison?: string;
  sub?: string;
  trend?: "positive" | "caution" | "neutral";
}

export function MetricCard({ label, value, comparison, sub, trend }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface p-6 space-y-2">
      <p className="section-label">{label}</p>
      <p className="text-[36px] font-light text-foreground leading-none">{value}</p>
      {comparison && (
        <p
          className={cn(
            "text-[13px] font-medium",
            trend === "positive"
              ? "text-positive-foreground"
              : trend === "caution"
                ? "text-caution-foreground"
                : "text-muted-foreground",
          )}
        >
          {comparison}
        </p>
      )}
      {sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
