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
type DashboardSummaryStats = DashboardOverview["stats"] & { activeEscalations?: number };

function buildSummary(
  stats: DashboardOverview["stats"],
  today: DashboardOverview["today"],
  period: "morning" | "afternoon" | "evening",
): string {
  const activeEscalations = (stats as DashboardSummaryStats).activeEscalations ?? 0;
  const signals: SignalEntry[] = [
    { count: stats.pendingApprovals, label: "approval" },
    // TODO(PR4): add activeEscalations to DashboardOverviewSchema, remove cast
    { count: activeEscalations, label: "escalation" },
    { count: today.appointments.count, label: "booking" },
    { count: today.leads.count, label: "new inquiry" },
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
        {buildSummary(overview.stats, overview.today, overview.greeting.period)}
      </p>
    </div>
  );
}
