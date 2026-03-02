"use client";

import type { DlqMessage } from "@/hooks/use-dlq";
import { cn } from "@/lib/utils";

interface DlqTableProps {
  messages: DlqMessage[];
  onRetry: (id: string) => void;
  onResolve: (id: string) => void;
  isRetrying?: boolean;
  isResolving?: boolean;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  exhausted: "bg-red-100 text-red-800",
  resolved: "bg-green-100 text-green-800",
};

export function DlqTable({ messages, onRetry, onResolve, isRetrying, isResolving }: DlqTableProps) {
  if (messages.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No failed messages found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-3 pr-4 font-medium">Channel</th>
            <th className="pb-3 pr-4 font-medium">Stage</th>
            <th className="pb-3 pr-4 font-medium">Error</th>
            <th className="pb-3 pr-4 font-medium">Retries</th>
            <th className="pb-3 pr-4 font-medium">Status</th>
            <th className="pb-3 pr-4 font-medium">Created</th>
            <th className="pb-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((msg) => (
            <tr key={msg.id} className="border-b last:border-0">
              <td className="py-3 pr-4">
                <span className="font-mono text-xs">{msg.channel}</span>
              </td>
              <td className="py-3 pr-4">
                <span className="font-mono text-xs">{msg.stage}</span>
              </td>
              <td className="py-3 pr-4 max-w-[300px] truncate" title={msg.errorMessage}>
                {msg.errorMessage}
              </td>
              <td className="py-3 pr-4">
                {msg.retryCount}/{msg.maxRetries}
              </td>
              <td className="py-3 pr-4">
                <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", statusColors[msg.status])}>
                  {msg.status}
                </span>
              </td>
              <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">
                {new Date(msg.createdAt).toLocaleString()}
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  {msg.status === "pending" && (
                    <button
                      onClick={() => onRetry(msg.id)}
                      disabled={isRetrying}
                      className="px-2 py-1 text-xs rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}
                  {msg.status !== "resolved" && (
                    <button
                      onClick={() => onResolve(msg.id)}
                      disabled={isResolving}
                      className="px-2 py-1 text-xs rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
