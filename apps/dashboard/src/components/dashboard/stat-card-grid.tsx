import { StatCard } from "./stat-card";
import type { ComponentProps } from "react";
import { formatRelative } from "@/lib/format";

interface StatCardGridProps {
  stats: Array<ComponentProps<typeof StatCard>>;
  lastUpdated?: string;
}

export function StatCardGrid({ stats, lastUpdated }: StatCardGridProps) {
  return (
    <div>
      <div
        style={{ display: "grid", gap: "16px" }}
        className="grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
      >
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
      {lastUpdated && (
        <p
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "var(--sw-text-muted)",
            textAlign: "right",
          }}
        >
          Last updated {formatRelative(lastUpdated)}
        </p>
      )}
    </div>
  );
}
