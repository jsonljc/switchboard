"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useRoiSummary } from "@/hooks/use-roi";
import { MetricCard } from "@/components/roi/metric-card";
import { FunnelBars } from "@/components/roi/funnel-bars";
import { BreakdownTable } from "@/components/roi/breakdown-table";
import { HealthIndicator } from "@/components/roi/health-indicator";

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export default function RoiPage() {
  const { status } = useSession();
  const [rangeDays, setRangeDays] = useState(30);
  const [breakdown, setBreakdown] = useState<"campaign" | "channel">("campaign");

  if (status === "unauthenticated") redirect("/login");

  const now = new Date();
  const dateRange = {
    from: new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };

  const { data, isLoading } = useRoiSummary(dateRange, breakdown);

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Loading ROI data...</p>
      </div>
    );
  }

  const f = data.funnel;
  const rate = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

  const funnelStages = [
    { label: "Inquiry", count: f.inquiry, rate: "—" },
    { label: "Qualified", count: f.qualified, rate: rate(f.qualified, f.inquiry) },
    { label: "Booked", count: f.booked, rate: rate(f.booked, f.qualified) },
    { label: "Purchased", count: f.purchased, rate: rate(f.purchased, f.booked) },
    { label: "Completed", count: f.completed, rate: rate(f.completed, f.purchased) },
  ];

  const nameKey = breakdown === "campaign" ? "campaignId" : "channel";
  const breakdownRows = (data.breakdown as Array<Record<string, unknown>>).map((row) => ({
    name: (row[nameKey] as string) ?? "Unknown",
    leads: (row.inquiry as number) ?? 0,
    qualified: (row.qualified as number) ?? 0,
    booked: (row.booked as number) ?? 0,
    revenue: (row.totalRevenue as number) ?? 0,
    bookingRate: rate((row.booked as number) ?? 0, (row.inquiry as number) ?? 0),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={`rounded-md px-3 py-1 text-sm ${
                rangeDays === r.days ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <HealthIndicator
          status={data.health.status}
          lastRun={data.health.lastRun}
          checks={data.health.checks as never[]}
        />
      </div>

      <div className="grid grid-cols-5 gap-4">
        <MetricCard label="Leads" value={f.inquiry} />
        <MetricCard label="Qualified" value={f.qualified} subtext={rate(f.qualified, f.inquiry)} />
        <MetricCard label="Booked" value={f.booked} subtext={rate(f.booked, f.inquiry)} />
        <MetricCard label="Revenue" value={`$${f.totalRevenue.toLocaleString()}`} />
        <MetricCard label="Booking Rate" value={rate(f.booked, f.inquiry)} />
      </div>

      <div className="rounded-lg border p-6">
        <h2 className="mb-4 text-lg font-semibold">Funnel</h2>
        <FunnelBars stages={funnelStages} maxCount={f.inquiry} />
      </div>

      <div className="rounded-lg border p-6">
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setBreakdown("campaign")}
            className={`rounded-md px-3 py-1 text-sm ${
              breakdown === "campaign" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            By Campaign
          </button>
          <button
            onClick={() => setBreakdown("channel")}
            className={`rounded-md px-3 py-1 text-sm ${
              breakdown === "channel" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            By Channel
          </button>
        </div>
        <BreakdownTable rows={breakdownRows} />
      </div>
    </div>
  );
}
