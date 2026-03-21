"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useConversations,
  useConversationDetail,
  type ConversationListItem,
} from "@/hooks/use-conversations";

/* ─── Constants ─── */
const STATUS_FILTERS = ["all", "active", "completed", "expired", "human_override"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const CHANNEL_COLORS: Record<string, string> = {
  telegram: "bg-sky-500/15 text-sky-700",
  whatsapp: "bg-emerald-500/15 text-emerald-700",
  slack: "bg-violet-500/15 text-violet-700",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-positive/15 text-positive-foreground",
  completed: "bg-muted text-muted-foreground",
  expired: "bg-caution/15 text-caution-foreground",
  human_override: "bg-orange-500/15 text-orange-700",
};

/* ─── Helpers ─── */
function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/* ─── Badge ─── */
function Badge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", className)}>
      {label}
    </span>
  );
}

/* ─── Conversation row ─── */
function ConversationRow({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: ConversationListItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const channelClass = CHANNEL_COLORS[conversation.channel] ?? "bg-muted text-muted-foreground";
  const statusClass = STATUS_COLORS[conversation.status] ?? "bg-muted text-muted-foreground";

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-xl border border-border/60 p-4 transition-colors duration-150",
        isSelected ? "bg-surface border-foreground/20" : "bg-background hover:bg-surface/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px] font-medium text-foreground">
              {truncate(conversation.principalId, 24)}
            </span>
            <Badge label={conversation.channel} className={channelClass} />
            <Badge label={conversation.status} className={statusClass} />
          </div>
          {conversation.currentIntent && (
            <p className="text-[12px] text-muted-foreground">
              Intent: {conversation.currentIntent}
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">
            Thread: {truncate(conversation.threadId, 20)}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
          {timeAgo(conversation.lastActivityAt)}
        </span>
      </div>
    </button>
  );
}

/* ─── Message thread ─── */
function MessageThread({ conversationId }: { conversationId: string }) {
  const { data, isLoading, error } = useConversationDetail(conversationId);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border/60 bg-surface p-5">
        <p className="text-[13px] text-caution-foreground">
          Failed to load messages: {error.message}
        </p>
      </div>
    );
  }

  if (!data || !data.messages || data.messages.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-surface p-5">
        <p className="text-[13px] text-muted-foreground">No messages in this conversation yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[14px] font-medium text-foreground">Messages</h3>
        <span className="text-[12px] text-muted-foreground">({data.messages.length})</span>
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
        {data.messages.map((msg, idx) => {
          const isUser = msg.role === "user" || msg.role === "lead";
          return (
            <div key={idx} className={cn("flex", isUser ? "justify-start" : "justify-end")}>
              <div
                className={cn(
                  "rounded-xl px-3.5 py-2.5 max-w-[80%]",
                  isUser ? "bg-muted text-foreground" : "bg-foreground/10 text-foreground",
                )}
              >
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                <p
                  className={cn(
                    "text-[10px] mt-1",
                    isUser ? "text-muted-foreground" : "text-muted-foreground",
                  )}
                >
                  {msg.role} · {timeAgo(msg.timestamp)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main page ─── */
export default function ConversationsPage() {
  const { status } = useSession();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useConversations({ status: statusFilter });

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-10">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  const conversations = data?.conversations ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Conversations</h1>
        <p className="text-[14px] text-muted-foreground">
          Monitor live and past conversations with leads across channels.
        </p>
      </section>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => {
              setStatusFilter(f);
              setSelectedId(null);
            }}
            className={cn(
              "px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors duration-150",
              statusFilter === f
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {f === "all"
              ? "All"
              : f === "human_override"
                ? "Human Override"
                : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="text-[12px] text-muted-foreground ml-2">
          {conversations.length} thread{conversations.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-caution/30 bg-caution/5 p-5">
          <p className="text-[13.5px] text-caution-foreground">
            Could not load conversations. The API may be unavailable.
          </p>
          <p className="text-[12px] text-muted-foreground mt-1">{error.message}</p>
        </div>
      )}

      {/* Empty state */}
      {!error && conversations.length === 0 && (
        <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
          <p className="text-[14px] text-muted-foreground">
            No conversations found{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.
          </p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Conversations appear here when leads message your bot.
          </p>
        </div>
      )}

      {/* Conversation list + detail */}
      {conversations.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* List */}
          <div className="space-y-2">
            {conversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                isSelected={selectedId === conv.id}
                onSelect={() => setSelectedId(selectedId === conv.id ? null : conv.id)}
              />
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            {selectedId ? (
              <div className="rounded-xl border border-border/60 bg-surface p-5">
                <MessageThread conversationId={selectedId} />
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
                <p className="text-[13.5px] text-muted-foreground">
                  Select a conversation to view the message thread.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
