interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { direction: "up" | "down"; text: string };
  badge?: { text: string; variant: "overdue" };
  isRevenue?: boolean;
  animateCountUp?: boolean;
  countUpDelay?: number;
}

export function StatCard({
  label,
  value,
  delta,
  badge,
  isRevenue: _isRevenue,
  animateCountUp: _animateCountUp,
  countUpDelay: _countUpDelay,
}: StatCardProps) {
  return (
    <div
      style={{
        background: "var(--sw-surface-raised)",
        border: "1px solid var(--sw-border)",
        borderRadius: "12px",
        padding: "24px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "28px",
          fontWeight: 600,
          color: "var(--sw-text-primary)",
          lineHeight: 1,
          margin: 0,
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: "13px",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--sw-text-muted)",
          marginTop: "8px",
        }}
      >
        {label}
      </p>
      {delta && (
        <p style={{ fontSize: "13px", color: "var(--sw-text-secondary)", marginTop: "4px" }}>
          {delta.direction === "up" ? "↑" : "↓"} {delta.text}
        </p>
      )}
      {badge && (
        <span
          style={{
            display: "inline-block",
            marginTop: "6px",
            padding: "2px 8px",
            borderRadius: "9999px",
            fontSize: "13px",
            color: "hsl(0, 38%, 40%)",
            background: "hsl(0, 20%, 95%)",
          }}
        >
          {badge.text}
        </span>
      )}
    </div>
  );
}
