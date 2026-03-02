"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useDlqMessages, useDlqStats, useRetryDlqMessage, useResolveDlqMessage } from "@/hooks/use-dlq";
import { DlqTable } from "@/components/dlq/dlq-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

const STATUS_OPTIONS = ["pending", "exhausted", "resolved"] as const;

export default function DlqPage() {
  const { status } = useSession();
  const [statusFilter, setStatusFilter] = useState<string>("pending");

  if (status === "unauthenticated") redirect("/login");
  const { data: messages = [], isLoading, isError, error, refetch } = useDlqMessages(statusFilter);
  const { data: stats } = useDlqStats();
  const retryMutation = useRetryDlqMessage();
  const resolveMutation = useResolveDlqMessage();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dead Letter Queue</h1>
        <p className="text-muted-foreground">
          View and manage failed messages across all channels.
        </p>
      </div>

      {isError ? (
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load messages</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">Total</div>
                <div className="text-2xl font-bold">{stats.total}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">Pending</div>
                <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">Exhausted</div>
                <div className="text-2xl font-bold text-red-600">{stats.exhausted}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">Resolved</div>
                <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {STATUS_OPTIONS.map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
                {stats && ` (${stats[s as keyof typeof stats]})`}
              </Button>
            ))}
          </div>

          <div className="rounded-lg border p-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <DlqTable
                messages={messages}
                onRetry={(id) => retryMutation.mutate(id)}
                onResolve={(id) => resolveMutation.mutate(id)}
                isRetrying={retryMutation.isPending}
                isResolving={resolveMutation.isPending}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
