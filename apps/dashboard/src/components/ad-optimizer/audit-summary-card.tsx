"use client";

import type { AuditReportSummary } from "@/hooks/use-ad-optimizer";

interface AuditSummaryCardProps {
  summary: AuditReportSummary;
  dateRange: { since: string; until: string };
  targetCPA?: number;
  targetROAS?: number;
}

function getHealthColor(
  summary: AuditReportSummary,
  targetCPA?: number,
  targetROAS?: number,
): string {
  if (!targetCPA && !targetROAS) return "text-muted-foreground";
  const cpa = summary.totalSpend / Math.max(summary.totalLeads, 1);
  const roasOk = !targetROAS || summary.overallROAS >= targetROAS;
  const cpaOk = !targetCPA || cpa <= targetCPA;
  if (roasOk && cpaOk) return "text-positive";
  if (roasOk || cpaOk) return "text-caution";
  return "text-negative";
}

export function AuditSummaryCard({
  summary,
  dateRange,
  targetCPA,
  targetROAS,
}: AuditSummaryCardProps) {
  const healthColor = getHealthColor(summary, targetCPA, targetROAS);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Audit Summary</h3>
        <span className="text-sm text-muted-foreground">
          {dateRange.since} — {dateRange.until}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCell
          label="ROAS"
          value={`${summary.overallROAS.toFixed(1)}x`}
          className={healthColor}
        />
        <StatCell label="Spend" value={`$${summary.totalSpend.toLocaleString()}`} />
        <StatCell label="Leads" value={summary.totalLeads.toLocaleString()} />
        <StatCell label="Revenue" value={`$${summary.totalRevenue.toLocaleString()}`} />
      </div>

      <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
        <span>
          {summary.activeCampaigns} active campaign{summary.activeCampaigns !== 1 ? "s" : ""}
        </span>
        {summary.campaignsInLearning > 0 && (
          <span className="text-caution">{summary.campaignsInLearning} in learning phase</span>
        )}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${className}`}>{value}</p>
    </div>
  );
}
