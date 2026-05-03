"use client";

import { useEscalationDetail } from "@/hooks/use-escalations";

const VISIBLE_COUNT = 5;

type Message = { role: string; text: string; timestamp: string };

// No "Open full conversation →" link — apps/dashboard/src/app/(auth)/conversations/
// has only page.tsx (a list view), no [id] dynamic route. The 5-message inline
// transcript surfaces enough context to make a reply decision; full-thread
// navigation can be revisited in Phase 3 if a per-conversation route is added.
export function TranscriptPanel({ escalationId }: { escalationId: string }) {
  const { data, isLoading, error } = useEscalationDetail(escalationId);

  if (isLoading) {
    return (
      <div className="transcript-loading" aria-label="Loading transcript">
        <div className="transcript-row transcript-skeleton" />
        <div className="transcript-row transcript-skeleton" />
        <div className="transcript-row transcript-skeleton" />
      </div>
    );
  }

  if (error) {
    return <div className="transcript-error">Couldn&apos;t load transcript.</div>;
  }

  const history =
    (data as { conversationHistory?: Message[] } | undefined)?.conversationHistory ?? [];

  if (history.length === 0) {
    return <div className="transcript-empty">No messages yet.</div>;
  }

  const visible = history.slice(-VISIBLE_COUNT);

  return (
    <div className="transcript-panel" aria-label="Recent messages">
      {visible.map((msg, i) => {
        const role: "lead" | "agent" | "owner" =
          msg.role === "user" || msg.role === "lead"
            ? "lead"
            : msg.role === "owner"
              ? "owner"
              : "agent";
        return (
          <div key={i} className={`transcript-row role-${role}`}>
            <div className="transcript-meta">
              <span className="transcript-role">{role}</span>
              <span className="transcript-time">{msg.timestamp}</span>
            </div>
            <div className="transcript-text">{msg.text}</div>
          </div>
        );
      })}
    </div>
  );
}
