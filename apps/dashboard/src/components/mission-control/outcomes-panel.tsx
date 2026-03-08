"use client";

import { useSpend } from "@/hooks/use-spend";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Users, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function OutcomesPanel() {
  const { data: spend, isLoading: spendLoading } = useSpend();
  const { data: crmContacts, isLoading: contactsLoading } = useQuery({
    queryKey: queryKeys.crm.contacts(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/crm/contacts");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const isLoading = spendLoading || contactsLoading;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Today&apos;s Outcomes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
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
                <span>Ad Spend</span>
              </div>
              <span className="text-lg font-semibold">
                ${(spend?.today ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>Total Leads</span>
              </div>
              <span className="text-lg font-semibold">
                {(crmContacts?.data as unknown[])?.length ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Zap className="h-4 w-4" />
                <span>Actions</span>
              </div>
              <span className="text-lg font-semibold">{spend?.actionsToday ?? 0}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
