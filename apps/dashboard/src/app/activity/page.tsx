"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ActivityItem } from "@/components/activity/activity-item";
import { ActivityDetail } from "@/components/activity/activity-detail";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAudit } from "@/hooks/use-audit";
import { AlertTriangle } from "lucide-react";

export default function ActivityPage() {
  const { status } = useSession();
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const { data, isLoading, isError, error, refetch } = useAudit({ eventType: filter, limit: 50 });
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null);

  if (status === "unauthenticated") redirect("/login");

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Activity</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load activity</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity</h1>

      <ActivityFilters activeFilter={filter} onFilterChange={setFilter} />

      <div className="space-y-1">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 p-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))
        ) : data?.entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No activity yet</p>
          </div>
        ) : (
          data?.entries.map((entry) => (
            <ActivityItem
              key={entry.id}
              entry={entry}
              onClick={() => setSelectedEntry(entry)}
            />
          ))
        )}
      </div>

      <Sheet open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <SheetContent>
          {selectedEntry && <ActivityDetail entry={selectedEntry} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
