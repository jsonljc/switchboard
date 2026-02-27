"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { SpendCard } from "@/components/spend/spend-card";
import { SpendChart } from "@/components/spend/spend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpend } from "@/hooks/use-spend";
import { useIdentity } from "@/hooks/use-identity";
import { useApprovalCount } from "@/hooks/use-approvals";
import { Activity, ShieldCheck, XCircle, Zap } from "lucide-react";

export default function HomePage() {
  const { status } = useSession();
  const { data: spend, isLoading: spendLoading } = useSpend();
  const { data: identity, isLoading: identityLoading } = useIdentity();
  const pendingCount = useApprovalCount();

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

  const limits = identity?.spec?.globalSpendLimits;
  const isLoading = spendLoading || identityLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Badge variant="outline" className="gap-1">
          <Zap className="h-3 w-3" />
          AI active
        </Badge>
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
        <Card>
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
        <Card>
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
        <Card>
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
      </div>
    </div>
  );
}
