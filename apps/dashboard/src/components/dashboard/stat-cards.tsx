"use client";

interface StatCardsProps {
  stats: { label: string; value: string | number }[];
}

export function StatCards({ stats }: StatCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-border/60 bg-surface p-4 text-center"
        >
          <p className="text-[24px] font-semibold text-foreground leading-none">
            {stat.value}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1.5 uppercase tracking-wide">
            {stat.label}
          </p>
        </div>
      ))}
    </div>
  );
}
