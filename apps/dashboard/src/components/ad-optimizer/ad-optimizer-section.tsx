"use client";

import { useAdOptimizerAudit } from "@/hooks/use-ad-optimizer";
import { AuditSummaryCard } from "./audit-summary-card";
import { OutputFeed } from "./output-feed";
import { MetricTrendChart } from "./metric-trend-chart";
import { Skeleton } from "@/components/ui/skeleton";

interface AdOptimizerSectionProps {
  deploymentId: string;
  inputConfig?: Record<string, unknown>;
}

export function AdOptimizerSection({ deploymentId, inputConfig }: AdOptimizerSectionProps) {
  const { data, isLoading, error } = useAdOptimizerAudit(deploymentId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !data?.latestReport) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="text-lg font-semibold mb-2">Ad Optimizer</h3>
        <p className="text-muted-foreground text-sm">
          {error
            ? "Failed to load audit data."
            : "No audit reports yet. The first audit will run on the next scheduled cycle."}
        </p>
      </div>
    );
  }

  const report = data.latestReport;
  const targetCPA = inputConfig?.targetCPA as number | undefined;
  const targetROAS = inputConfig?.targetROAS as number | undefined;

  return (
    <div className="space-y-6">
      <AuditSummaryCard
        summary={report.summary}
        dateRange={report.dateRange}
        targetCPA={targetCPA}
        targetROAS={targetROAS}
      />
      <OutputFeed
        insights={report.insights}
        watches={report.watches}
        recommendations={report.recommendations}
      />
      {report.periodDeltas.length > 0 && <MetricTrendChart periodDeltas={report.periodDeltas} />}
    </div>
  );
}
