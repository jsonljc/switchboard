"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SpendCard } from "@/components/spend/spend-card";
import { SpendChart } from "@/components/spend/spend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpend } from "@/hooks/use-spend";
import { useIdentity } from "@/hooks/use-identity";
import { useApprovalCount } from "@/hooks/use-approvals";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Activity, ShieldCheck, XCircle, Zap, AlertTriangle } from "lucide-react";

export default function HomePage() {
  const { status } = useSession();
  const { data: spend, isLoading: spendLoading, isError: spendError, refetch: refetchSpend } = useSpend();
  const { data: identity, isLoading: identityLoading, isError: identityError, refetch: refetchIdentity } = useIdentity();
  const pendingCount = useApprovalCount();
  const { data: healthData } = useQuery({
    queryKey: queryKeys.health.deep(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/health");
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (status === "unauthenticated") redirect("/login");
  if (status === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-[280px]" />
      </div>
    );
  }

  if (spendError || identityError) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Failed to load dashboard data</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Could not connect to the server. Please try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => { refetchSpend(); refetchIdentity(); }}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const limits = identity?.spec?.globalSpendLimits;
  const isLoading = spendLoading || identityLoading;
  const isHealthy = healthData?.healthy !== false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/settings/system">
          <Badge
            variant={isHealthy ? "outline" : "destructive"}
            className="gap-1 cursor-pointer"
          >
            <Zap className="h-3 w-3" />
            {isHealthy ? "AI active" : "Needs attention"}
          </Badge>
        </Link>
      </div>

      {/* Spend cards */}
      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <SpendCard
            title="Today"
            spent={spend?.today ?? 0}
            limit={limits?.daily ?? null}
          />
          <SpendCard
            title="This Week"
            spent={spend?.thisWeek ?? 0}
            limit={limits?.weekly ?? null}
          />
          <SpendCard
            title="This Month"
            spent={spend?.thisMonth ?? 0}
            limit={limits?.monthly ?? null}
          />
        </div>
      )}

      {/* Spend chart */}
      {isLoading ? (
        <Skeleton className="h-[280px]" />
      ) : (
        <SpendChart data={spend?.dailyTrend ?? []} />
      )}

      {/* Quick stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Link href="/activity" className="block">
          <Card className="hover:border-primary/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Actions Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {spendLoading ? <Skeleton className="h-8 w-12" /> : spend?.actionsToday ?? 0}
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/approvals" className="block">
          <Card className="hover:border-primary/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Pending Approvals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingCount}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/activity?filter=denied" className="block">
          <Card className="hover:border-primary/50 transition-colors h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                Denied Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {spendLoading ? <Skeleton className="h-8 w-12" /> : spend?.deniedToday ?? 0}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
