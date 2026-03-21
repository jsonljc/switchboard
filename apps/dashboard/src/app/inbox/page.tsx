"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useInbox, useReleaseHandoff } from "@/hooks/use-inbox";
import type { InboxItem } from "@/hooks/use-inbox";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatSlaRemaining(ms: number): string {
  if (ms <= 0) return "Overdue";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m left`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m left`;
}

const REASON_LABELS: Record<string, string> = {
  human_requested: "Human requested",
  max_turns_exceeded: "Too many turns",
  complex_objection: "Complex objection",
  sentiment_negative: "Negative sentiment",
  high_value_lead: "High-value lead",
  policy_violation: "Policy violation",
};

const CHANNEL_STYLES: Record<string, string> = {
  telegram: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  whatsapp: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  slack: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  sms: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  web_chat: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400",
};

/* ─── Inbox Card ─── */

function InboxCard({
  item,
  onRelease,
  isReleasing,
}: {
  item: InboxItem;
  onRelease: (id: string) => void;
  isReleasing: boolean;
}) {
  const { handoff, conversation } = item;
  const leadName = handoff.leadSnapshot.name ?? "Unknown lead";
  const channel = handoff.leadSnapshot.channel;
  const channelStyle = CHANNEL_STYLES[channel] ?? CHANNEL_STYLES.web_chat;
  const reasonLabel = REASON_LABELS[handoff.reason] ?? handoff.reason;
  const slaOverdue = item.slaRemaining <= 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      {/* Header: name, channel badge, time */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <h3 className="text-[15px] font-medium text-foreground truncate">{leadName}</h3>
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0",
              channelStyle,
            )}
          >
            {channel}
          </span>
        </div>
        <span className="text-[12px] text-muted-foreground shrink-0">
          {formatTimeAgo(item.waitingSince)}
        </span>
      </div>

      {/* Reason + SLA */}
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          {reasonLabel}
        </span>
        <span
          className={cn(
            "text-[12px] font-medium",
            slaOverdue ? "text-negative" : "text-muted-foreground",
          )}
        >
          {formatSlaRemaining(item.slaRemaining)}
        </span>
      </div>

      {/* Key topics */}
      {handoff.conversationSummary.keyTopics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {handoff.conversationSummary.keyTopics.map((topic) => (
            <span
              key={topic}
              className="px-2 py-0.5 rounded-md text-[11px] bg-muted text-muted-foreground"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Suggested opening */}
      {handoff.conversationSummary.suggestedOpening && (
        <p className="text-[13px] text-muted-foreground italic leading-snug">
          &ldquo;{handoff.conversationSummary.suggestedOpening}&rdquo;
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1 border-t border-border/60">
        <Link
          href={`/conversations?selected=${conversation?.id ?? handoff.sessionId}`}
          className="px-5 py-2.5 rounded-lg text-[13px] font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
        >
          Jump in
        </Link>
        <button
          onClick={() => onRelease(handoff.id)}
          disabled={isReleasing}
          className="px-4 py-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {isReleasing ? "Releasing\u2026" : "Release"}
        </button>
      </div>
    </div>
  );
}

/* ─── Page ─── */

export default function InboxPage() {
  const { status } = useSession();
  const { data, isLoading } = useInbox();
  const releaseMutation = useReleaseHandoff();

  if (status === "unauthenticated") redirect("/login");

  const items = data?.items ?? [];

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Inbox</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Conversations that need a human touch.
        </p>
      </section>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44" />)
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[15px] text-foreground font-medium">All clear.</p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              No conversations need your attention right now.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <InboxCard
              key={item.handoff.id}
              item={item}
              onRelease={(id) => releaseMutation.mutate(id)}
              isReleasing={
                releaseMutation.isPending && releaseMutation.variables === item.handoff.id
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
