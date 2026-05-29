"use client";

export interface InboxEmptyStateProps {
  /** True when a teammate filter is active (changes the copy to name the agent). */
  filtered: boolean;
  /** Display name of the filtered agent; required when `filtered` is true. */
  agentName?: string;
}

/**
 * Calm empty state for the inbox queue (design: inbox-v2 `.inbox-empty`) — NOT
 * an error. When a filter is active the copy names the agent; otherwise it
 * reassures that the team is on top of it.
 */
export function InboxEmptyState({ filtered, agentName }: InboxEmptyStateProps) {
  const name = agentName ?? "this teammate";
  return (
    <div className="inbox-empty">
      <span className="inbox-empty-mark" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <h2>{filtered ? `Nothing from ${name}.` : "That's everything."}</h2>
      <p>
        {filtered
          ? `${name} doesn't have anything waiting for you. Switch back to All to see the rest of the queue.`
          : "Your team is on top of it. New items will land here as they need a decision."}
      </p>
      <span className="inbox-empty-meta">Polling · checked just now</span>
    </div>
  );
}
