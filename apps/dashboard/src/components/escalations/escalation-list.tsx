"use client";

import { useState } from "react";
import {
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
  CheckCircle2,
  Info,
} from "lucide-react";
import { useEscalations, useReplyToEscalation } from "@/hooks/use-escalations";

type FilterStatus = "pending" | "released";

interface Escalation {
  id: string;
  reason: string;
  conversationSummary?: string;
  createdAt: string;
  slaDeadline?: string;
  leadName?: string;
  leadChannel?: string;
}

/* ------------------------------------------------------------------ */
/*  SlaIndicator                                                      */
/* ------------------------------------------------------------------ */

function SlaIndicator({ deadline }: { deadline: string }) {
  const now = Date.now();
  const target = new Date(deadline).getTime();
  const diff = target - now;

  if (diff <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
        <Clock className="h-3 w-3" />
        Overdue
      </span>
    );
  }

  const hoursLeft = Math.max(1, Math.ceil(diff / (1000 * 60 * 60)));
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
      <Clock className="h-3 w-3" />
      {hoursLeft}h left
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Relative time helper                                              */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  EscalationCard                                                    */
/* ------------------------------------------------------------------ */

function EscalationCard({ escalation }: { escalation: Escalation }) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  const replyMutation = useReplyToEscalation();

  const summaryPreview =
    escalation.conversationSummary && escalation.conversationSummary.length > 120
      ? `${escalation.conversationSummary.slice(0, 120)}...`
      : escalation.conversationSummary;

  const handleSend = () => {
    if (!reply.trim()) return;
    replyMutation.mutate(
      { id: escalation.id, message: reply.trim() },
      {
        onSuccess: () => {
          setReply("");
          setSent(true);
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* Collapsed header */}
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{escalation.reason}</p>
          {!expanded && summaryPreview && (
            <p className="text-xs text-muted-foreground truncate">{summaryPreview}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {escalation.slaDeadline && <SlaIndicator deadline={escalation.slaDeadline} />}
          <span className="text-xs text-muted-foreground">
            {relativeTime(escalation.createdAt)}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {escalation.conversationSummary && (
            <p className="text-sm text-muted-foreground">{escalation.conversationSummary}</p>
          )}

          {(escalation.leadName || escalation.leadChannel) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {escalation.leadName && <span>Lead: {escalation.leadName}</span>}
              {escalation.leadChannel && <span>Channel: {escalation.leadChannel}</span>}
            </div>
          )}

          {/* Info banner after successful reply */}
          {sent && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Your reply has been saved. It will be included in the conversation when the customer
                sends their next message. Direct message delivery is coming in a future update.
              </p>
            </div>
          )}

          {/* Reply form */}
          {!sent && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Type a reply..."
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
              />
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={!reply.trim() || replyMutation.isPending}
                onClick={handleSend}
              >
                {replyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EscalationList (default export)                                   */
/* ------------------------------------------------------------------ */

export function EscalationList() {
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const { data, isLoading } = useEscalations(filter);
  const escalations = (data as { escalations?: Escalation[] })?.escalations ?? [];

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["pending", "released"] as const).map((status) => (
          <button
            key={status}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === status
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            onClick={() => setFilter(status)}
          >
            {status === "pending" ? "Pending" : "Resolved"}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && escalations.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          {filter === "pending" ? (
            <>
              <CheckCircle2 className="h-8 w-8" />
              <p className="text-sm">No pending escalations</p>
            </>
          ) : (
            <>
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm">No resolved escalations yet</p>
            </>
          )}
        </div>
      )}

      {/* Escalation cards */}
      {!isLoading && escalations.map((esc) => <EscalationCard key={esc.id} escalation={esc} />)}
    </div>
  );
}
