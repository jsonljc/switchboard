"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Calendar, TrendingUp, Clock, DollarSign } from "lucide-react";

interface ClinicReport {
  period: { startDate: string; endDate: string };
  organizationId: string;
  leads: { total: number; byStage: Array<{ stage: string; count: number; totalValue: number }> };
  bookings: { count: number; fromDeals: number; fromAudit: number };
  responseTime: {
    averageMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    sampleSize: number;
  };
  adCorrelation: {
    leadsFromAds: number;
    bookingsFromAds: number;
    adAttributionRate: number;
  };
  costMetrics: {
    adSpend: number | null;
    costPerBooking: number | null;
    costPerLead: number | null;
  };
}

export default function ReportsPage() {
  const { status } = useSession();
  const [report, setReport] = useState<ClinicReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adSpend, setAdSpend] = useState<string>("");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0]!;
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]!);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (adSpend) params.set("adSpend", adSpend);
      const qs = params.toString();
      const res = await fetch(`/api/dashboard/reports/clinic${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load report");
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, adSpend]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  if (status === "unauthenticated") redirect("/login");

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Clinic Reports</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load report</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchReport}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clinic Reports</h1>
        <p className="text-muted-foreground">Performance metrics for your clinic.</p>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <label className="text-sm font-medium block mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Ad Spend ($)</label>
          <input
            type="number"
            value={adSpend}
            onChange={(e) => setAdSpend(e.target.value)}
            placeholder="Optional"
            className="border rounded px-3 py-2 text-sm w-32"
          />
        </div>
        <Button onClick={fetchReport} size="sm">
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : report ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.leads.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Bookings</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.bookings.count}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {report.responseTime.averageMs != null
                    ? `${Math.round(report.responseTime.averageMs / 1000)}s`
                    : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {report.responseTime.sampleSize} conversations
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cost per Booking</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {report.costMetrics.costPerBooking != null
                    ? `$${report.costMetrics.costPerBooking.toFixed(2)}`
                    : "N/A"}
                </div>
                {report.costMetrics.costPerLead != null && (
                  <p className="text-xs text-muted-foreground">
                    ${report.costMetrics.costPerLead.toFixed(2)} per lead
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {report.leads.byStage.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Leads by Stage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {report.leads.byStage.map((s) => (
                    <div key={s.stage} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{s.stage.replace(/_/g, " ")}</span>
                      <span className="font-medium">{s.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
