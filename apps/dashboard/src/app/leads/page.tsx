"use client";

import { useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeads, type LeadEntry, type LeadStage } from "@/hooks/use-leads";
import { cn } from "@/lib/utils";

/* ─── Stage styling ─── */
const STAGE_BADGE: Record<LeadStage, string> = {
  NEW: "bg-muted text-muted-foreground",
  QUALIFIED: "bg-caution/15 text-foreground",
  BOOKED: "bg-positive/15 text-positive-foreground",
  LOST: "bg-muted/50 text-muted-foreground/70",
};

const STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  BOOKED: "Booked",
  LOST: "Lost",
};

const FILTER_KEYS = ["ALL", "NEW", "QUALIFIED", "BOOKED"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/* ─── Helpers ─── */
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

function isTodayLead(createdAt: string): boolean {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return new Date(createdAt).getTime() >= midnight.getTime();
}

/* ─── Lead row ─── */
function LeadRow({ lead }: { lead: LeadEntry }) {
  return (
    <div className="flex items-center gap-4 py-4 border-b border-border/40 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <p className="text-[14.5px] font-medium text-foreground">{lead.displayName}</p>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] font-medium",
              STAGE_BADGE[lead.stage],
            )}
          >
            {STAGE_LABELS[lead.stage]}
          </span>
          {lead.contact.channel && (
            <span className="text-[12px] text-muted-foreground capitalize">
              {lead.contact.channel}
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {lead.contact.email ?? lead.contact.phone ?? "No contact info"}
          {" · "}
          {formatRelative(lead.contact.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {lead.contact.phone && (
          <a
            href={`tel:${lead.contact.phone}`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground border border-border/60 rounded-lg transition-colors duration-fast"
          >
            <Phone className="h-3.5 w-3.5" />
            Call
          </a>
        )}
        <Link
          href={`/leads/${lead.contact.id}`}
          className="px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors duration-fast"
        >
          View →
        </Link>
      </div>
    </div>
  );
}

/* ─── Page content ─── */
function LeadsPageContent() {
  const { status } = useSession();
  const { data: leads = [], isLoading, isError, refetch } = useLeads();
  const [filter, setFilter] = useState<FilterKey>("ALL");

  if (status === "unauthenticated") redirect("/login");

  const todayLeads = leads.filter((l) => isTodayLead(l.contact.createdAt));

  const stageCounts: Record<FilterKey, number> = {
    ALL: leads.length,
    NEW: leads.filter((l) => l.stage === "NEW").length,
    QUALIFIED: leads.filter((l) => l.stage === "QUALIFIED").length,
    BOOKED: leads.filter((l) => l.stage === "BOOKED").length,
  };

  const filteredLeads = filter === "ALL" ? leads : leads.filter((l) => l.stage === filter);

  const filterLabel = (key: FilterKey): string => {
    const count = stageCounts[key];
    const base = key === "ALL" ? "All" : STAGE_LABELS[key];
    return count > 0 ? `${base} · ${count}` : base;
  };

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Leads</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Everyone your assistant has reached out to.
        </p>
      </section>

      {/* Today's leads highlight */}
      {!isLoading && todayLeads.length > 0 && (
        <section>
          <p className="section-label mb-3">
            Today · {todayLeads.length} new{todayLeads.length === 1 ? "" : ""}
          </p>
          <div className="flex gap-2 flex-wrap">
            {todayLeads.map((lead) => (
              <Link
                key={lead.contact.id}
                href={`/leads/${lead.contact.id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border/60 hover:border-border transition-colors duration-fast"
              >
                <span className="text-[13.5px] font-medium text-foreground">
                  {lead.displayName}
                </span>
                {lead.contact.channel && (
                  <span className="text-[11.5px] text-muted-foreground capitalize">
                    {lead.contact.channel}
                  </span>
                )}
                <span className="text-[11.5px] text-muted-foreground/60">
                  {formatRelative(lead.contact.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Filter strip */}
      <div className="flex items-center gap-0 border-b border-border/60">
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast whitespace-nowrap",
              filter === key
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {isLoading ? (key === "ALL" ? "All" : STAGE_LABELS[key]) : filterLabel(key)}
            {filter === key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4 border-b border-border/40">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-8 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="py-12 text-center">
          <p className="text-[14px] text-muted-foreground">Couldn&apos;t load leads.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 text-[13px] text-foreground underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[15px] text-foreground font-medium">No leads yet.</p>
          <p className="text-[14px] text-muted-foreground mt-1.5">
            {filter === "ALL"
              ? "Your assistant will add leads here as they come in."
              : `No ${STAGE_LABELS[filter].toLowerCase()} leads right now.`}
          </p>
        </div>
      ) : (
        <div>
          {filteredLeads.map((lead) => (
            <LeadRow key={lead.contact.id} lead={lead} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Page shell ─── */
export default function LeadsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-8">
          <Skeleton className="h-6 w-24" />
          <div className="space-y-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-4 border-b border-border/40">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-8 w-16 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      }
    >
      <LeadsPageContent />
    </Suspense>
  );
}
