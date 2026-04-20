import { StatCard } from "./stat-card";
import type { ComponentProps } from "react";

interface StatCardGridProps {
  stats: Array<ComponentProps<typeof StatCard>>;
}

export function StatCardGrid({ stats }: StatCardGridProps) {
  return (
    <div
      style={{ display: "grid", gap: "16px" }}
      className="grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
    >
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}
