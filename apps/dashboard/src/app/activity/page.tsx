"use client";

import { Suspense, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useSearchParams } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAudit, type AuditEntryResponse } from "@/hooks/use-audit";
import { ActivityDetail } from "@/components/activity/activity-detail";
import { translateEvent } from "@/components/activity/event-translator";
import { cn } from "@/lib/utils";

export default function ActivityPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-8">
          <Skeleton className="h-6 w-24" />
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-4 border-b border-border/50">
                <Skeleton className="h-[7px] w-[7px] rounded-full mt-1.5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <ActivityPageContent />
    </Suspense>
  );
}

function formatRelative(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

function formatDate(timestamp: string): string {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const FILTERS = [
  { key: undefined, label: "Everything" },
  { key: "tool.invoked", label: "Work done" },
  { key: "action.approved", label: "You approved" },
  { key: "action.denied", label: "Blocked" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function ActivityPageContent() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");
  const initialFilter: FilterKey = filterParam === "denied" ? "action.denied" : undefined;

  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const { data, isLoading, isError, refetch } = useAudit({
    eventType: filter as string | undefined,
    limit: 60,
  });
  const [selectedEntry, setSelectedEntry] = useState<AuditEntryResponse | null>(null);
  const entries = Array.isArray(data?.entries) ? data.entries : [];

  if (status === "unauthenticated") redirect("/login");

  // Group by date
  const grouped: { date: string; items: AuditEntryResponse[] }[] = [];
  entries.forEach((entry) => {
    const dateLabel = formatDate(entry.timestamp);
    const last = grouped[grouped.length - 1];
    if (last && last.date === dateLabel) {
      last.items.push(entry);
    } else {
      grouped.push({ date: dateLabel, items: [entry] });
    }
  });

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Activity</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          What your assistant has done, and what you&apos;ve decided.
        </p>
      </section>

      {/* Filter strip */}
      <div className="flex items-center gap-0 border-b border-border/60">
        {FILTERS.map((f) => (
          <button
            key={String(f.key)}
            onClick={() => setFilter(f.key)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast",
              filter === f.key
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {filter === f.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4 py-4 border-b border-border/50">
              <Skeleton className="h-[7px] w-[7px] rounded-full mt-1.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/5" />
              </div>
            </div>
          ))}
        </div>
      ) : isError || data?.error ? (
        <div className="py-12 text-center">
          <p className="text-[14px] text-muted-foreground">
            Couldn&apos;t load activity. Make sure the API is running.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 text-[13px] text-foreground underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[15px] text-foreground font-medium">Nothing to show.</p>
          <p className="text-[14px] text-muted-foreground mt-1.5">
            Try &ldquo;Everything&rdquo; to see all recent activity.
          </p>
        </div>
      ) : (
        <div>
          {grouped.map((group) => (
            <div key={group.date} className="mb-8">
              {/* Date header with entry count */}
              <p className="section-label py-3 mb-0 border-b border-border/40">
                {group.date}
                <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/60">
                  · {group.items.length} {group.items.length === 1 ? "event" : "events"}
                </span>
              </p>
              {group.items.map((entry) => {
                const isWin =
                  entry.eventType === "action.executed" || entry.eventType === "action.approved";
                const isBlocked =
                  entry.eventType === "action.denied" || entry.eventType === "action.rejected";
                const displayText = translateEvent(entry);

                return (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className={cn(
                      "w-full flex items-start gap-4 py-4 border-b border-border/40 last:border-0 text-left group transition-colors duration-fast",
                      isWin
                        ? "border-l-2 border-l-positive bg-positive/[0.04] -mx-3 px-3 rounded-r-lg hover:bg-positive/[0.07]"
                        : isBlocked
                          ? "border-l-2 border-l-caution bg-caution/[0.04] -mx-3 px-3 rounded-r-lg hover:bg-caution/[0.07]"
                          : "hover:bg-surface-raised -mx-3 px-3 rounded-lg",
                    )}
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
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "leading-snug",
                          isWin ? "text-[15px] text-foreground" : "text-[14px] text-foreground",
                        )}
                      >
                        {displayText}
                      </p>
                      <time className="text-[12px] text-muted-foreground mt-0.5 block">
                        {formatRelative(entry.timestamp)}
                      </time>
                    </div>
                    <span className="text-[12px] text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0 self-center">
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <SheetContent>{selectedEntry && <ActivityDetail entry={selectedEntry} />}</SheetContent>
      </Sheet>
    </div>
  );
}
