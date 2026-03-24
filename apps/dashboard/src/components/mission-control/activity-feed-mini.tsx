"use client";

import Link from "next/link";
import { useAudit } from "@/hooks/use-audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";

export function ActivityFeedMini() {
  const { data, isLoading } = useAudit({ limit: 5 });
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const loadError = data?.error;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Recent activity
          </CardTitle>
          <Link href="/" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </>
        ) : loadError ? (
          <p className="text-sm text-muted-foreground py-2">
            Couldn’t load activity. Make sure the API is running and you’re signed in.
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            When your assistant takes action or you respond to a request, it’ll show here.
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-2 py-2 border-b last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{entry.summary}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatRelative(entry.timestamp)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
