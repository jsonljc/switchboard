import Link from "next/link";
import { SectionLabel } from "./section-label";

interface RevenueSummaryProps {
  total: number;
  count: number;
  topSource: { name: string; amount: number } | null;
  dailyBreakdown?: number[];
  animate?: boolean;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function RevenueSummary({
  total,
  count,
  topSource,
  dailyBreakdown: _dailyBreakdown,
  animate: _animate,
}: RevenueSummaryProps) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionLabel>Revenue (7d)</SectionLabel>
        <Link
          href="/dashboard/roi"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          See details →
        </Link>
      </div>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "32px",
            fontWeight: 600,
            color: "var(--sw-text-primary)",
            margin: 0,
            lineHeight: 1,
          }}
        >
          {formatCurrency(total)}
        </p>
        <p style={{ fontSize: "14px", color: "var(--sw-text-secondary)", marginTop: "8px" }}>
          {count === 0
            ? "No revenue recorded in the last 7 days"
            : `from ${count} transaction${count !== 1 ? "s" : ""}`}
        </p>
        {topSource && (
          <p style={{ fontSize: "14px", color: "var(--sw-text-secondary)", marginTop: "4px" }}>
            Top: {topSource.name} · {formatCurrency(topSource.amount)}
          </p>
        )}
      </div>
    </div>
  );
}
