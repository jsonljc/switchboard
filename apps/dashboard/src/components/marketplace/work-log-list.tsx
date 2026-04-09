"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ConversationTranscript } from "./conversation-transcript";

interface TaskEntry {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  output: Record<string, unknown> | null;
}

interface WorkLogListProps {
  tasks: TaskEntry[];
}

function isTaskOutput(output: Record<string, unknown> | null): output is {
  summary?: string;
  outcome?: string;
  messages?: Array<{ role: "lead" | "agent"; text: string; timestamp: string }>;
} {
  return output !== null;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_ICONS: Record<string, string> = {
  approved: "\u2713",
  completed: "\u2713",
  rejected: "\u2717",
  pending: "\u23F3",
  awaiting_review: "\u23F3",
  running: "\u23F3",
};

export function WorkLogList({ tasks }: WorkLogListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="divide-y divide-border">
      {tasks.map((task) => {
        const output = isTaskOutput(task.output) ? task.output : null;
        const isExpanded = expandedId === task.id;
        const messageCount = Array.isArray(output?.messages) ? output.messages.length : 0;

        return (
          <div key={task.id} className="py-4">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "text-lg shrink-0 w-6 text-center",
                  task.status === "approved" || task.status === "completed"
                    ? "text-positive"
                    : task.status === "rejected"
                      ? "text-negative"
                      : "text-muted-foreground",
                )}
              >
                {STATUS_ICONS[task.status] ?? "?"}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {typeof output?.summary === "string" ? output.summary : "Task"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {formatTimeAgo(task.createdAt)} &middot; {messageCount} message
                  {messageCount !== 1 ? "s" : ""} &middot; {task.status}
                </p>
              </div>

              {Array.isArray(output?.messages) && output.messages.length > 0 && (
                <button
                  onClick={() => setExpandedId(isExpanded ? null : task.id)}
                  aria-label={isExpanded ? "Collapse transcript" : "Expand transcript"}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {isExpanded ? "Hide" : "Show"}
                </button>
              )}
            </div>

            {isExpanded && Array.isArray(output?.messages) && (
              <div className="ml-9 mt-2 border-l-2 border-border pl-4">
                <ConversationTranscript messages={output.messages} />
              </div>
            )}
          </div>
        );
      })}

      {tasks.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">No tasks yet.</p>
      )}
    </div>
  );
}
