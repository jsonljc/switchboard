"use client";

import { useState } from "react";
import { useDlqMessages, useDlqStats, useRetryDlqMessage, useResolveDlqMessage } from "@/hooks/use-dlq";
import { DlqTable } from "@/components/dlq/dlq-table";

const STATUS_OPTIONS = ["pending", "exhausted", "resolved"] as const;

export default function DlqPage() {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const { data: messages = [], isLoading } = useDlqMessages(statusFilter);
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
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-md border ${
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {stats && ` (${stats[s as keyof typeof stats]})`}
          </button>
        ))}
      </div>

      <div className="rounded-lg border p-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
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
    </div>
  );
}
