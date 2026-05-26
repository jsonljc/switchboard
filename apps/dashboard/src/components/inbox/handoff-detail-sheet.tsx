"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import { relativeTime, dueIn } from "@/lib/decisions/time";
import { useEscalationDetail } from "@/hooks/use-escalation-detail";
import { InboxAgentAvatar } from "./inbox-agent-avatar";
import type { Decision } from "@/lib/decisions/types";
import type { ConversationTurn } from "@/hooks/use-escalation-detail";

// Reason enum → plain-English chip (no red/yellow/green; identity-color system).
const REASON_LABELS: Record<string, string> = {
  human_requested: "They asked for you",
  max_turns_exceeded: "Conversation stalled",
  complex_objection: "Tricky objection",
  negative_sentiment: "Tone turned",
  compliance_concern: "Compliance question",
  booking_failure: "Booking didn't go through",
  escalation_timeout: "Waiting too long",
  missing_knowledge: "Needs your knowledge",
  outside_whatsapp_window: "Outside WhatsApp window",
};

const VISIBLE_RECENT = 3;

export interface HandoffDetailSheetProps {
  decision: Decision;
  nowMs?: number;
  /** Resolves with whether the reply was delivered now (false = 502 saved-but-undelivered). */
  onReply: (message: string) => Promise<{ delivered: boolean }>;
  /** Resolves when the handoff is marked resolved. */
  onResolve: (resolutionNote?: string) => Promise<void>;
  onClose: () => void;
}

function SheetShell({
  agentKey,
  onClose,
  children,
}: {
  agentKey: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="sheet ds"
      data-agent={agentKey}
      data-kind="handoff"
      data-open="true"
      role="dialog"
      aria-modal="true"
    >
      <span className="sheet-handle" />
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close detail">
        ×
      </button>
      {children}
    </div>
  );
}

function HandoffSkeleton({ agentKey, onClose }: { agentKey: string; onClose: () => void }) {
  return (
    <SheetShell agentKey={agentKey} onClose={onClose}>
      <div className="sheet-body ds-body ds-loading" data-testid="handoff-skeleton">
        <div className="ds-sk ds-sk-head" />
        <div className="ds-sk ds-sk-line" />
        <div className="ds-sk ds-sk-card" />
        <div className="ds-sk ds-sk-bubble" />
      </div>
    </SheetShell>
  );
}

function HandoffFetchError({
  agentKey,
  onClose,
  onRetry,
}: {
  agentKey: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <SheetShell agentKey={agentKey} onClose={onClose}>
      <div className="sheet-body ds-body ds-fetch-error">
        <div className="ds-eyebrow">Couldn&apos;t load this handoff</div>
        <p>The connection dropped on the way to your team. The list is still safe — try again.</p>
        <button type="button" className="ds-action ds-action-secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </SheetShell>
  );
}

export function HandoffDetailSheet({
  decision,
  nowMs = Date.now(),
  onReply,
  onResolve,
  onClose,
}: HandoffDetailSheetProps) {
  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;
  const { data, isLoading, isError, refetch } = useEscalationDetail(decision.sourceRef.sourceId);

  const [draft, setDraft] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [expandThread, setExpandThread] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [undelivered, setUndelivered] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset composer/resolve state when the open decision changes.
  useEffect(() => {
    setDraft("");
    setSeeded(false);
    setExpandThread(false);
    setResolveOpen(false);
    setResolveNote("");
    setSending(false);
    setResolving(false);
    setUndelivered(false);
  }, [decision.id]);

  if (isLoading) return <HandoffSkeleton agentKey={decision.agentKey} onClose={onClose} />;
  if (isError || !data)
    return (
      <HandoffFetchError
        agentKey={decision.agentKey}
        onClose={onClose}
        onRetry={() => void refetch()}
      />
    );

  const { escalation, conversationHistory } = data;

  const reasonLabel =
    (escalation.reason && REASON_LABELS[escalation.reason]) || escalation.reason || "Handed to you";
  const due = dueIn(escalation.slaDeadlineAt, nowMs);

  const lead = escalation.leadSnapshot ?? {};
  const qual = escalation.qualificationSnapshot ?? {};
  const conv = escalation.conversationSummary ?? {};
  const topics = conv.keyTopics ?? [];
  const objections = conv.objectionHistory ?? [];
  const leadFirstName = lead.name ? lead.name.split(/\s/)[0] : "the lead";

  const turns: ConversationTurn[] = Array.isArray(conversationHistory) ? conversationHistory : [];
  const visibleThread = expandThread
    ? turns
    : turns.slice(Math.max(0, turns.length - VISIBLE_RECENT));
  const hiddenCount = turns.length - visibleThread.length;

  const whoFor = (role?: string) =>
    role === "user"
      ? lead.name
        ? leadFirstName
        : "Lead"
      : role === "owner"
        ? agentName
        : role || "—";

  const useSuggested = () => {
    if (conv.suggestedOpening) {
      setDraft(conv.suggestedOpening);
      setSeeded(true);
      // yield a tick so the textarea value commits before we focus it
      setTimeout(() => taRef.current?.focus(), 30);
    }
  };

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    setUndelivered(false);
    try {
      const { delivered } = await onReply(draft.trim());
      if (delivered) {
        onClose();
      } else {
        setUndelivered(true); // 502 — reply saved, channel delivery failed
      }
    } finally {
      setSending(false);
    }
  };
  const doResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await onResolve(resolveNote.trim() || undefined);
      onClose();
    } finally {
      setResolving(false);
    }
  };

  return (
    <SheetShell agentKey={decision.agentKey} onClose={onClose}>
      <div className="sheet-body ds-body">
        {/* 1. HEADER */}
        <header className="ds-head">
          <div className="ds-head-id">
            <InboxAgentAvatar agentKey={decision.agentKey} size={36} />
            <div className="ds-head-id-text">
              <div className="ds-head-line">
                <span className="ds-head-name" data-agent={decision.agentKey}>
                  {agentName}
                </span>
                <span className="ds-head-needs">is handing this to you</span>
              </div>
              <div className="ds-head-reason-row">
                <span className="ds-reason-chip">{reasonLabel}</span>
                {due && (
                  <>
                    <span className="ds-dot">·</span>
                    <span className="ds-sla" data-due={due.state}>
                      {due.label}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* 2. THE LEAD */}
        <section className="ds-section ds-lead-section">
          <div className="ds-eyebrow">The lead</div>
          <div className="ds-lead-card">
            <div className="ds-lead-name-row">
              <span className="ds-lead-name">{lead.name ?? "Lead details pending"}</span>
              {lead.channel && <span className="ds-lead-channel">via {lead.channel}</span>}
            </div>
            {lead.serviceInterest && (
              <div className="ds-lead-interest">
                <span className="ds-eyebrow-inline">Asking about</span>
                <span>{lead.serviceInterest}</span>
              </div>
            )}
            {(lead.phone || lead.email) && (
              <div className="ds-lead-contact">
                {lead.phone && (
                  <span>
                    <span className="ds-eyebrow-inline">Phone</span> {lead.phone}
                  </span>
                )}
                {lead.email && (
                  <span>
                    <span className="ds-eyebrow-inline">Email</span> {lead.email}
                  </span>
                )}
              </div>
            )}
            {lead.source && (
              <div className="ds-lead-source">
                <span className="ds-eyebrow-inline">First touch</span>
                <span>{lead.source}</span>
              </div>
            )}
            {(qual.qualificationStage || typeof qual.leadScore === "number") && (
              <div className="ds-qual-line">
                {qual.qualificationStage && (
                  <span className="ds-qual-stage">{qual.qualificationStage}</span>
                )}
                {typeof qual.leadScore === "number" && (
                  <>
                    <span className="ds-dot">·</span>
                    <span className="ds-qual-score">Lead score {qual.leadScore}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 3. WHERE IT STANDS */}
        {(conv.sentiment ||
          typeof conv.turnCount === "number" ||
          topics.length > 0 ||
          objections.length > 0 ||
          conv.suggestedOpening) && (
          <section className="ds-section ds-where-section">
            <div className="ds-eyebrow">Where it stands</div>
            <div className="ds-where-meta">
              {conv.sentiment && (
                <span className="ds-where-meta-cell">
                  <span className="ds-eyebrow-inline">Tone</span>
                  <span className="ds-sentiment-word">{conv.sentiment}</span>
                </span>
              )}
              {typeof conv.turnCount === "number" && (
                <span className="ds-where-meta-cell">
                  <span className="ds-eyebrow-inline">Turns</span>
                  <span>{conv.turnCount}</span>
                </span>
              )}
            </div>
            {topics.length > 0 && (
              <div className="ds-where-block">
                <span className="ds-eyebrow-inline">Topics</span>
                <ul className="ds-tag-row">
                  {topics.map((t, i) => (
                    <li key={i} className="ds-tag">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {objections.length > 0 && (
              <div className="ds-where-block">
                <span className="ds-eyebrow-inline">What they pushed back on</span>
                <ul className="ds-objection-list">
                  {objections.map((o, i) => (
                    <li key={i}>&ldquo;{o}&rdquo;</li>
                  ))}
                </ul>
              </div>
            )}
            {conv.suggestedOpening && (
              <div className="ds-suggested">
                <div className="ds-suggested-head">
                  <span className="ds-eyebrow-inline">Suggested opening</span>
                  <span className="ds-suggested-by">— from {agentName}</span>
                </div>
                <p className="ds-suggested-text">{conv.suggestedOpening}</p>
                <button
                  type="button"
                  className="ds-suggested-use"
                  onClick={useSuggested}
                  disabled={seeded}
                  data-seeded={seeded ? "true" : "false"}
                >
                  {seeded ? "Loaded into reply ↓" : "Start with this"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* 4. CONVERSATION */}
        <section className="ds-section ds-thread-section">
          <div className="ds-eyebrow">
            Conversation
            <span className="ds-eyebrow-meta">{turns.length} messages</span>
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              className="ds-thread-expand"
              onClick={() => setExpandThread(true)}
            >
              Show {hiddenCount} earlier {hiddenCount === 1 ? "message" : "messages"}
            </button>
          )}
          <ol className="ds-thread" data-testid="handoff-thread">
            {visibleThread.map((turn, i) => (
              <li key={i} className="ds-turn" data-role={turn.role}>
                <div className="ds-turn-meta">
                  <span className="ds-turn-who">{whoFor(turn.role)}</span>
                  <span className="ds-turn-time">{relativeTime(turn.timestamp, nowMs)}</span>
                </div>
                <div className="ds-turn-bubble">{turn.text}</div>
              </li>
            ))}
          </ol>
        </section>

        {/* 5. COMPOSER */}
        <section className="ds-section ds-composer-section">
          <div className="ds-eyebrow">Your reply</div>
          <div className="ds-composer">
            <textarea
              ref={taRef}
              className="ds-composer-textarea"
              rows={6}
              placeholder={`Write to ${leadFirstName}. ${agentName} hands the thread back to you the moment you send.`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="ds-composer-meta">
              <span>
                Sends to {leadFirstName}
                {lead.channel ? ` on ${lead.channel}` : ""} · {agentName} stops replying.
              </span>
              <span
                className="ds-composer-count"
                data-warn={draft.length > 600 ? "true" : undefined}
              >
                {draft.length}
              </span>
            </div>
            {undelivered && (
              <div className="ds-banner" data-state="undelivered" role="status">
                Saved — but we couldn&apos;t deliver it to {leadFirstName} right now. Try again, or
                reach out directly.
              </div>
            )}
          </div>
        </section>

        {/* 6. RESOLVE NOTE (collapsed by default) */}
        {resolveOpen && (
          <section className="ds-section ds-resolve-section">
            <div className="ds-eyebrow">Mark resolved</div>
            <textarea
              className="ds-resolve-note"
              rows={2}
              placeholder="Optional — note what you did (audit log only)"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
            />
            <div className="ds-resolve-actions">
              <button
                type="button"
                className="ds-action ds-action-secondary"
                onClick={() => setResolveOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ds-action ds-action-secondary ds-action-resolve"
                onClick={() => void doResolve()}
                disabled={resolving}
              >
                Mark resolved
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Docked actions */}
      <footer className="ds-actions">
        <button
          type="button"
          className="ds-action ds-action-dismiss"
          onClick={() => setResolveOpen((v) => !v)}
          data-toggled={resolveOpen ? "true" : undefined}
        >
          Mark resolved
        </button>
        <button
          type="button"
          className="ds-action ds-action-primary ds-action-send"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
        >
          Send &amp; hand back to {agentName}
        </button>
      </footer>
    </SheetShell>
  );
}
