"use client";

import Link from "next/link";
import { useAudit } from "@/hooks/use-audit";
import { translateEvent } from "@/components/activity/event-translator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";

export function TodayActivityFeed() {
  const { data, isLoading } = useAudit({ limit: 6 });
  const entries = data?.entries ?? [];

  if (isLoading) {
    return (
      <div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4 py-4 border-b border-border/40">
            <Skeleton className="h-[7px] w-[7px] rounded-full mt-1.5 shrink-0" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-6">
        <p className="text-[14px] text-muted-foreground">
          No activity yet. When your assistant takes action, it&apos;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry) => {
        const isWin =
          entry.eventType === "action.executed" || entry.eventType === "action.approved";
        const isBlocked =
          entry.eventType === "action.denied" || entry.eventType === "action.rejected";

        // Always translate through event-translator — never show raw eventType strings
        const displayText = translateEvent(entry);

        return (
          <div
            key={entry.id}
            className="flex items-start gap-4 py-4 border-b border-border/40 last:border-0"
          >
            <div
              className={cn(
                "mt-1.5 h-[7px] w-[7px] rounded-full shrink-0",
                isWin
                  ? "bg-positive"
                  : isBlocked
                    ? "bg-caution"
                    : entry.eventType.startsWith("tool.")
                      ? "bg-agent-active"
                      : "bg-agent-idle",
              )}
            />
            <p
              className={cn(
                "flex-1 leading-snug",
                isWin ? "text-[14.5px] text-foreground" : "text-[14px] text-foreground",
              )}
            >
              {displayText}
            </p>
            <time className="text-[12px] text-muted-foreground shrink-0 mt-0.5">
              {formatRelative(entry.timestamp)}
            </time>
          </div>
        );
      })}

      <Link
        href="/"
        className="inline-block mt-5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        See all activity →
      </Link>
    </div>
  );
}
