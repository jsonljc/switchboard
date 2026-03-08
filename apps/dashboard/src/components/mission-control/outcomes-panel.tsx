"use client";

import { useSpend } from "@/hooks/use-spend";
import { useApprovalCount } from "@/hooks/use-approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, CheckCircle, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function OutcomesPanel() {
  const { data: spend, isLoading: spendLoading } = useSpend();
  const approvalCount = useApprovalCount();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Today&apos;s Outcomes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {spendLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                <span>Spent today</span>
              </div>
              <span className="text-lg font-semibold">
                ${(spend?.today ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4" />
                <span>Tasks completed</span>
              </div>
              <span className="text-lg font-semibold">{spend?.actionsToday ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                <span>Approvals handled</span>
              </div>
              <span className="text-lg font-semibold">{approvalCount}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
