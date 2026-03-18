"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/pilot-report/metric-card";
import { FunnelChart } from "@/components/pilot-report/funnel-chart";
import { CampaignTable } from "@/components/pilot-report/campaign-table";
import { usePilotReport } from "@/hooks/use-pilot-report";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export default function ResultsPage() {
  const { status } = useSession();
  const { data: report, isLoading } = usePilotReport();

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-10">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Results</h1>
        <p className="text-[14px] text-muted-foreground">
          Your pilot report will appear here once data starts flowing.
        </p>
      </div>
    );
  }

  const stlValue =
    report.speedToLead.medianMs != null ? formatDuration(report.speedToLead.medianMs) : "\u2014";

  const convRate =
    report.conversion.ratePercent != null ? `${report.conversion.ratePercent}%` : "\u2014";

  const cpp = report.costPerPatient.amount != null ? `$${report.costPerPatient.amount}` : "\u2014";

  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Results</h1>
        <p className="text-[14px] text-muted-foreground">
          What your money has produced in the last {report.period.days} days.
        </p>
      </section>

      {/* Three metric cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Speed to lead"
          value={stlValue}
          comparison={
            report.speedToLead.baseline ? `vs ${report.speedToLead.baseline} before` : undefined
          }
          trend="positive"
          sub={
            report.speedToLead.percentWithin2Min != null
              ? `${report.speedToLead.percentWithin2Min}% replied within 2 minutes`
              : `${report.speedToLead.sampleSize} conversations measured`
          }
        />
        <MetricCard
          label="Leads \u2192 paying patients"
          value={convRate}
          comparison={
            report.conversion.baselinePercent != null
              ? `vs ~${report.conversion.baselinePercent}% before`
              : undefined
          }
          trend="positive"
          sub={`${report.conversion.payingPatients} paying patients from ${report.conversion.leads} leads`}
        />
        <MetricCard
          label="Cost per paying patient"
          value={cpp}
          comparison={
            report.costPerPatient.baselineAmount != null
              ? `vs ~$${report.costPerPatient.baselineAmount} before`
              : undefined
          }
          trend="positive"
          sub={
            report.costPerPatient.roas != null
              ? `Spend: $${report.costPerPatient.adSpend} \u2192 Revenue: $${report.costPerPatient.totalRevenue} \u2192 ROAS: ${report.costPerPatient.roas.toFixed(1)}:1`
              : undefined
          }
        />
      </section>

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Funnel */}
      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold text-foreground">Patient journey</h2>
        <FunnelChart
          stages={[
            { label: "Leads", count: report.funnel.leads },
            { label: "Qualified", count: report.funnel.qualified },
            { label: "Booked", count: report.funnel.booked },
            { label: "Showed up", count: report.funnel.showedUp },
            { label: "Paid", count: report.funnel.paid },
          ]}
        />
      </section>

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Campaign table */}
      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold text-foreground">
          Which campaigns bring paying patients
        </h2>
        <CampaignTable campaigns={report.campaigns} />
      </section>
    </div>
  );
}
