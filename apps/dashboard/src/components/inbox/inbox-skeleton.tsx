"use client";

/**
 * List-shaped loading placeholder for the inbox queue. Mirrors the
 * `.inbox-page` > `.inbox-list` masthead + queue structure so the page keeps
 * its layout while the decision feed (or its refetch) is in flight, instead of
 * flashing the bare "Loading…" text — `.inbox-loading` had no styling at all.
 * role="status" + aria-label keep the loading state announced to assistive tech.
 */
export function InboxSkeleton() {
  return (
    <div className="inbox-page">
      <div className="inbox-list">
        <div
          className="inbox-skeleton"
          role="status"
          aria-label="Loading your inbox"
          aria-busy="true"
        >
          <div className="inbox-skeleton-masthead">
            <span className="inbox-skeleton-line inbox-skeleton-title" />
            <span className="inbox-skeleton-line inbox-skeleton-eyebrow" />
          </div>
          <div className="inbox-skeleton-chips">
            {[0, 1, 2].map((i) => (
              <span key={i} className="inbox-skeleton-chip" />
            ))}
          </div>
          <div className="inbox-skeleton-queue">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="inbox-skeleton-row" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
