import type { DashboardOverview } from "@switchboard/schemas";

interface DashboardHeaderProps {
  overview: DashboardOverview;
}

const GREETING_TEXT = {
  morning: "Good morning.",
  afternoon: "Good afternoon.",
  evening: "Good evening.",
};

type SignalEntry = { count: number; label: string };

function buildSummary(
  stats: DashboardOverview["stats"],
  period: "morning" | "afternoon" | "evening",
): string {
  const signals: SignalEntry[] = [
    { count: stats.pendingApprovals, label: "approval" },
    { count: (stats as Record<string, number>).activeEscalations ?? 0, label: "escalation" },
    { count: stats.bookingsToday, label: "booking" },
    { count: stats.newInquiriesToday, label: "new inquiry" },
    { count: stats.overdueTasks, label: "overdue task" },
  ];

  const active = signals
    .filter((s) => s.count > 0)
    .slice(0, 3)
    .map((s) => `${s.count} ${s.label}${s.count !== 1 ? "s" : ""}`)
    .join(" · ");

  return active || `All clear this ${period}.`;
}

export function DashboardHeader({ overview }: DashboardHeaderProps) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "24px",
            fontWeight: 600,
            color: "var(--sw-text-primary)",
            margin: 0,
          }}
        >
          {GREETING_TEXT[overview.greeting.period]}
        </h1>
        <time style={{ fontSize: "13px", color: "var(--sw-text-muted)" }}>{today}</time>
      </div>
      <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", marginTop: "8px" }}>
        {buildSummary(overview.stats, overview.greeting.period)}
      </p>
    </div>
  );
}
