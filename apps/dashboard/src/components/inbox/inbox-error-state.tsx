"use client";

export interface InboxErrorStateProps {
  onRetry: () => void;
}

/**
 * Distinct error state for the inbox queue. Never reuses the empty-state copy —
 * an error is an error, not "all clear" (regression guard against isError
 * mis-routing to the empty branch).
 */
export function InboxErrorState({ onRetry }: InboxErrorStateProps) {
  return (
    <div className="inbox-error">
      <span className="inbox-error-eyebrow">Couldn't load</span>
      <h2 className="inbox-error-heading">Couldn't load your inbox.</h2>
      <p className="inbox-error-body">
        Looks like the connection dropped. Try again — your team is still working in the background.
      </p>
      <button type="button" className="inbox-error-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
