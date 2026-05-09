"use client";

import { useState } from "react";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import "./inbox-drawer.css";

function describeTotal(total: number, isLoading: boolean, isError: boolean): string {
  if (isLoading) return "Reading…";
  if (isError) return "Couldn't load.";
  if (total === 0) return "You're caught up.";
  return `${total} pending across your team.`;
}

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useDecisionFeed(null);
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
      <SheetContent side="right" className="inbox-drawer sm:max-w-[28rem]">
        <SheetHeader>
          <SheetTitle className="font-display">Inbox</SheetTitle>
          <SheetDescription>{describeTotal(total, isLoading, isError)}</SheetDescription>
        </SheetHeader>
        {/* List body added in Task 4 */}
      </SheetContent>
    </Sheet>
  );
}
