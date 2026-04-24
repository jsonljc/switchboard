"use client";

import { useState } from "react";
import { MessageSquare, ChevronDown, ChevronRight } from "lucide-react";
import { useConversations, useConversationDetail } from "@/hooks/use-conversations";
import { useConversationOverride } from "@/hooks/use-conversation-override";
import { ConversationTranscript } from "@/components/marketplace/conversation-transcript";
import { cn } from "@/lib/utils";

type FilterStatus = "all" | "active" | "human_override";

const STATUS_FILTERS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "human_override", label: "Overridden" },
];

function StatusPill({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        Active
      </span>
    );
  }
  if (status === "human_override") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
        You control
      </span>
    );
  }
  if (status === "awaiting_approval") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
        Awaiting approval
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
      {status}
    </span>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return <span>just now</span>;
  if (minutes < 60) return <span>{minutes}m ago</span>;
  if (hours < 24) return <span>{hours}h ago</span>;
  return <span>{days}d ago</span>;
}

function ConversationCard({
  conversation,
  expanded,
  onToggle,
}: {
  conversation: {
    id: string;
    threadId: string;
    status: string;
    channel: string;
    currentIntent: string | null;
    lastActivityAt: string;
  };
  expanded: boolean;
  onToggle: () => void;
}) {
  const { data: detail } = useConversationDetail(expanded ? conversation.threadId : null);
  const override = useConversationOverride();

  const handleTakeOver = () => {
    override.mutate({ threadId: conversation.threadId, override: true });
  };

  const handleRelease = () => {
    override.mutate({ threadId: conversation.threadId, override: false });
  };

  // Map API roles to transcript roles
  const transcriptMessages =
    detail?.messages.map((msg) => ({
      role: (msg.role === "user" ? "lead" : msg.role === "assistant" ? "agent" : "owner") as
        | "lead"
        | "agent"
        | "owner",
      text: msg.text,
      timestamp: msg.timestamp,
    })) ?? [];

  return (
    <div className="border border-border/50 rounded-lg bg-background">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-surface-raised/50 transition-colors rounded-lg"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusPill status={conversation.status} />
            <span className="text-xs text-muted-foreground font-mono">{conversation.channel}</span>
          </div>
          <p className="text-sm text-foreground">{conversation.currentIntent ?? "No intent yet"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            <RelativeTime iso={conversation.lastActivityAt} />
          </p>
        </div>
      </button>

      {expanded && detail && (
        <div className="border-t border-border/50 px-4 pb-3">
          {conversation.status === "human_override" && (
            <div className="mt-3 mb-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-sm text-blue-900 mb-2">
                You control this conversation. The agent will not respond.
              </p>
              <button
                onClick={handleRelease}
                disabled={override.isPending}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-50 disabled:opacity-50"
              >
                {override.isPending ? "Releasing..." : "Release to Agent"}
              </button>
            </div>
          )}

          {conversation.status === "active" && (
            <div className="mt-3 mb-2">
              <button
                onClick={handleTakeOver}
                disabled={override.isPending}
                className="px-3 py-1.5 text-xs font-medium text-foreground bg-surface-raised border border-border rounded hover:bg-surface-raised/80 disabled:opacity-50"
              >
                {override.isPending ? "Taking over..." : "Take Over"}
              </button>
            </div>
          )}

          <ConversationTranscript messages={transcriptMessages} />
        </div>
      )}
    </div>
  );
}

export default function ConversationsPage() {
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useConversations({
    status: filter === "all" ? undefined : filter,
  });

  const conversations = data?.conversations ?? [];

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 pb-24">
      <div className="flex items-center gap-2 mb-6">
        <MessageSquare className="h-6 w-6" />
        <h1 className="text-xl font-semibold">Conversations</h1>
      </div>

      <div className="flex gap-2 mb-4 border-b border-border/50">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2",
              filter === f.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-12">Loading conversations...</p>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No conversations yet.</p>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => (
            <ConversationCard
              key={conv.threadId}
              conversation={conv}
              expanded={expandedId === conv.threadId}
              onToggle={() => setExpandedId(expandedId === conv.threadId ? null : conv.threadId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
