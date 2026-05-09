"use client";

import { useState } from "react";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import "./inbox-drawer.css";

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data } = useDecisionFeed(null);
  const tenant = useTenantContext();

  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="folio-link"
          disabled={!tenantReady}
          aria-label={total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"}
        >
          {total > 0 && <span className="pip" />}
          <span>Inbox</span>
          {total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{total}</span>
            </>
          )}
        </button>
      </SheetTrigger>
    </Sheet>
  );
}
