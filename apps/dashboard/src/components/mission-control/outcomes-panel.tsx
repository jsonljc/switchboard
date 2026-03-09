"use client";

import { useSpend } from "@/hooks/use-spend";
import { useApprovalCount } from "@/hooks/use-approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ban, CheckCircle, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function OutcomesPanel() {
  const { data: summary, isLoading: spendLoading } = useSpend();
  const approvalCount = useApprovalCount();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Right now
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
                <CheckCircle className="h-4 w-4" />
                <span>Leads (30d)</span>
              </div>
              <span className="text-lg font-semibold">{summary?.outcomes.leads30d ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Ban className="h-4 w-4" />
                <span>Booked (30d)</span>
              </div>
              <span className="text-lg font-semibold">{summary?.outcomes.bookings30d ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                <span>Pending decisions</span>
              </div>
              <span className="text-lg font-semibold">{approvalCount}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
