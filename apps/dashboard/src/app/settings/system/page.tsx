"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query-keys";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";

interface HealthData {
  healthy: boolean;
  checks: Record<string, { status: string; latencyMs: number; error?: string; detail?: unknown }>;
  checkedAt: string;
}

export default function SystemHealthPage() {
  const { status } = useSession();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.health.deep(),
    queryFn: async (): Promise<HealthData> => {
      const res = await fetch("/api/dashboard/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (status === "unauthenticated") redirect("/login");

  const statusIcon = (s: string) => {
    if (s === "connected" || s === "running" || s === "healthy") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (s === "degraded" || s === "paused") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" aria-label="Go back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">System Health</h1>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Checking..." : "Refresh"}
          </Button>
        </div>
      </div>

      {isError && (
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load health status</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {data && (
        <div className="flex items-center gap-2">
          <Badge variant={data.healthy ? "default" : "destructive"}>
            {data.healthy ? "All Systems Healthy" : "Issues Detected"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Last checked: {new Date(data.checkedAt).toLocaleTimeString()}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {data && Object.entries(data.checks).map(([name, check]) => (
            <Card key={name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {statusIcon(check.status)}
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Badge variant={
                    check.status === "connected" || check.status === "running" || check.status === "healthy"
                      ? "default"
                      : check.status === "not_configured" || check.status === "in_memory"
                      ? "secondary"
                      : "destructive"
                  }>
                    {check.status}
                  </Badge>
                  {check.latencyMs > 0 && (
                    <span className="text-xs text-muted-foreground">{check.latencyMs}ms</span>
                  )}
                </div>
                {check.error && (
                  <p className="mt-2 text-xs text-destructive">{check.error}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
