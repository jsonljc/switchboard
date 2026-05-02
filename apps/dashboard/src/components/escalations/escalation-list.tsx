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
  FileText,
} from "lucide-react";
import { useEscalations, useEscalationDetail, useResolveEscalation } from "@/hooks/use-escalations";
import { useEscalationReply } from "@/hooks/use-escalation-reply";
import { ConversationTranscript } from "@/components/marketplace/conversation-transcript";

type FilterStatus = "pending" | "released" | "resolved";

interface Escalation {
  id: string;
  reason: string;
  conversationSummary?: string;
  createdAt: string;
  slaDeadlineAt?: string;
  leadName?: string;
  leadChannel?: string;
  // Nested lead snapshot from upstream (apps/api `/api/escalations/:id`).
  // The post-reply banner reads from this shape per DC-23 so the success
  // copy can address the customer by name and reference the real channel
  // (e.g. "Reply sent to Sarah via WhatsApp"). The flat leadName /
  // leadChannel fields above remain for the existing metadata row;
  // unifying them is DC-05's scope, not this PR's.
  leadSnapshot?: { name?: string; channel?: string } | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  sessionId?: string;
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
  const [replyError, setReplyError] = useState<string | null>(null);
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const { send: sendReply, isPending: replyPending } = useEscalationReply(escalation.id);
  const resolveMutation = useResolveEscalation();
  const { data: detailData } = useEscalationDetail(expanded ? escalation.id : null);

  const conversationHistory = detailData?.conversationHistory ?? [];
  const isResolved = !!escalation.resolvedAt;

  const summaryPreview =
    escalation.conversationSummary && escalation.conversationSummary.length > 120
      ? `${escalation.conversationSummary.slice(0, 120)}...`
      : escalation.conversationSummary;

  // DC-23: branched post-reply banner. The previous "saved, will be
  // included next time" copy was factually false — the upstream API only
  // returns 200 after `agentNotifier.sendProactive()` succeeds. Now:
  //   - 200 → channel-aware success banner ("Reply sent to {name} via {channel}").
  //   - 502 → channel-aware failure banner; reply text preserved so the
  //     operator can retry without re-typing.
  const leadName = escalation.leadSnapshot?.name ?? "the customer";
  const channelName = escalation.leadSnapshot?.channel ?? "their channel";

  const handleSend = async () => {
    if (!reply.trim()) return;
    setReplyError(null);
    try {
      const result = await sendReply(reply.trim());
      if (result.ok) {
        setReply("");
        setSent(true);
      } else {
        // 502 proactive-delivery failure: keep form open with text
        // preserved so the operator can retry or take another action.
        // Banner copy mirrors the success channel-aware form so the
        // operator immediately knows which transport failed.
        const upstreamMessage = result.error ?? "channel delivery failed.";
        setReplyError(`Couldn't deliver to ${channelName} right now — ${upstreamMessage}`);
      }
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Failed to send reply.");
    }
  };

  const handleResolve = () => {
    resolveMutation.mutate(
      { id: escalation.id, resolutionNote: resolutionNote.trim() || undefined },
      {
        onSuccess: () => {
          setShowResolveForm(false);
          setResolutionNote("");
        },
      },
    );
  };

  // Map conversation history roles to transcript roles
  const transcriptMessages = conversationHistory.map(
    (msg: { role: string; text: string; timestamp: string }) => ({
      role:
        msg.role === "user" || msg.role === "lead"
          ? ("lead" as const)
          : msg.role === "owner"
            ? ("owner" as const)
            : ("agent" as const),
      text: msg.text,
      timestamp: msg.timestamp,
    }),
  );

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
          {escalation.slaDeadlineAt && <SlaIndicator deadline={escalation.slaDeadlineAt} />}
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
          {(escalation.leadName || escalation.leadChannel) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {escalation.leadName && <span>Lead: {escalation.leadName}</span>}
              {escalation.leadChannel && <span>Channel: {escalation.leadChannel}</span>}
            </div>
          )}

          {/* Transcript view */}
          {transcriptMessages.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/30 px-3">
              <ConversationTranscript messages={transcriptMessages} />
            </div>
          ) : (
            escalation.conversationSummary && (
              <p className="text-sm text-muted-foreground">{escalation.conversationSummary}</p>
            )
          )}

          {/* Resolution note display (for resolved escalations) */}
          {isResolved && escalation.resolutionNote && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Internal note</p>
                  <p className="text-sm">{escalation.resolutionNote}</p>
                  {escalation.resolvedAt && (
                    <p className="text-xs text-muted-foreground">
                      Resolved {relativeTime(escalation.resolvedAt)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Truthful success banner (DC-23). Reached only when the upstream
              API returned 200, which guarantees `agentNotifier.sendProactive`
              succeeded. The previous "saved, will be included next time" copy
              was factually incorrect and has been removed. */}
          {sent && !isResolved && (
            <div
              className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"
              role="status"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Reply sent to {leadName} via {channelName}.
              </p>
            </div>
          )}

          {/* Reply form (only for non-resolved escalations) */}
          {!sent && !isResolved && (
            <div className="space-y-2">
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
                  disabled={!reply.trim() || replyPending}
                  onClick={handleSend}
                >
                  {replyPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Inline reply error (502 proactive-delivery failure or true error).
                  Branded copy lands in PR-2 Task 23 (DC-23). */}
              {replyError && (
                <p className="text-xs text-red-600" role="alert">
                  {replyError}
                </p>
              )}

              {/* Resolution form toggle */}
              {!showResolveForm && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => setShowResolveForm(true)}
                >
                  Resolve with note...
                </button>
              )}

              {/* Resolution form */}
              {showResolveForm && (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <label className="text-xs font-medium text-muted-foreground">
                    Internal note (optional)
                  </label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Add internal notes about resolution..."
                    rows={3}
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      disabled={resolveMutation.isPending}
                      onClick={handleResolve}
                    >
                      {resolveMutation.isPending ? "Resolving..." : "Mark Resolved"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      disabled={resolveMutation.isPending}
                      onClick={() => {
                        setShowResolveForm(false);
                        setResolutionNote("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
        {(["pending", "released", "resolved"] as const).map((status) => (
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
            {status === "pending" ? "Pending" : status === "released" ? "Released" : "Resolved"}
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
