"use client";

import { useInboxCount } from "@/hooks/use-decision-feed";

export function InboxLinkClient() {
  const count = useInboxCount();
  return (
    <button
      type="button"
      aria-disabled="true"
      title="Inbox drawer coming soon"
      className="folio-link"
    >
      {count > 0 && <span className="pip" />}
      <span>Inbox</span>
      {count > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="num">{count}</span>
        </>
      )}
    </button>
  );
}
