"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useSpend } from "@/hooks/use-spend";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PerformancePage() {
  const { status } = useSession();
  const { data, isLoading } = useSpend();

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Performance</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Actual spend from Meta and downstream outcomes from your CRM.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Spend (30d)" value={formatCurrency(data?.spend.last30Days)} />
        <MetricCard title="Leads (30d)" value={String(data?.outcomes.leads30d ?? 0)} />
        <MetricCard title="Qualified (30d)" value={String(data?.outcomes.qualifiedLeads30d ?? 0)} />
        <MetricCard title="Booked (30d)" value={String(data?.outcomes.bookings30d ?? 0)} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Last 7 days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.spend.trend.map((day) => (
            <div
              key={day.date}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border/60 py-3 last:border-0"
            >
              <span className="text-sm text-foreground">{day.date}</span>
              <span className="text-sm text-muted-foreground">
                Spend: {formatCurrency(day.spend)}
              </span>
              <span className="text-sm text-muted-foreground">Leads: {day.leads}</span>
              <span className="text-sm text-muted-foreground">Bookings: {day.bookings}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2">
            {data?.spend.connectionStatus === "connected"
              ? `Meta spend refreshed ${formatRelative(data.spend.freshness.fetchedAt)}`
              : "Connect Meta Ads to see source-backed spend."}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Cost per lead"
          value={formatCurrency(data?.outcomes.costPerLead30d)}
        />
        <MetricCard
          title="Cost per qualified lead"
          value={formatCurrency(data?.outcomes.costPerQualifiedLead30d)}
        />
        <MetricCard
          title="Cost per booking"
          value={formatCurrency(data?.outcomes.costPerBooking30d)}
        />
      </section>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatRelative(timestamp: string | null | undefined): string {
  if (!timestamp) return "recently";
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
