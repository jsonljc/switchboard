"use client";

import Link from "next/link";
import { useApprovals } from "@/hooks/use-approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function ActiveWorkPanel() {
  const { data, isLoading } = useApprovals();
  const approvals = data?.approvals?.slice(0, 3) ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Pending Approvals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </>
        ) : approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No pending approvals</p>
        ) : (
          approvals.map((approval) => (
            <Link
              key={approval.id}
              href={`/approvals/${approval.id}`}
              className="flex items-start justify-between gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{approval.summary}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">
                    {approval.riskCategory}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimeLeft(approval.expiresAt)}
                  </span>
                </div>
              </div>
            </Link>
          ))
        )}
        {approvals.length > 0 && (
          <Link
            href="/approvals"
            className="text-xs text-primary hover:underline block text-center pt-1"
          >
            View all approvals
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function formatTimeLeft(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
