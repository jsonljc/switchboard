"use client";

export interface InboxErrorStateProps {
  onRetry: () => void;
}

/**
 * Distinct error state for the inbox queue (design: inbox-v2
 * `.inbox-error-banner`). Never reuses the empty-state copy — an error is an
 * error, not "all clear" (regression guard against isError mis-routing to the
 * empty branch).
 */
export function InboxErrorState({ onRetry }: InboxErrorStateProps) {
  return (
    <div className="inbox-error-banner" role="alert">
      <span className="inbox-error-banner-eyebrow">Couldn&apos;t load</span>
      <p>
        Looks like the connection dropped. Try again — your team is still working in the background.
      </p>
      <button type="button" className="ds-action ds-action-secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
