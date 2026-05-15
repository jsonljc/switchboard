"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DecisionCard } from "@/components/decisions/decision-card";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";
import type { Decision } from "@/lib/decisions/types";
import { useRightDrawer } from "./right-drawer-context";
import "./inbox-drawer.css";

function describeTotal(total: number, isLoading: boolean, isError: boolean): string {
  if (isLoading) return "Reading…";
  if (isError) return "Couldn't load.";
  if (total === 0) return "You're caught up.";
  return `${total} pending across your team.`;
}

export function InboxDrawer() {
  const drawer = useRightDrawer();
  const open = drawer.kind === "inbox";
  const setOpen = (next: boolean) => (next ? drawer.open("inbox") : drawer.close());
  const { data, isLoading, isError } = useDecisionFeed(null);
  const tenant = useTenantContext();
  const queryClient = useQueryClient();

  const decisions = data?.decisions ?? [];
  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  const actedInSessionRef = useRef(false);

  // Reset the session-action flag on every open/close transition (in either direction).
  useEffect(() => {
    actedInSessionRef.current = false;
  }, [open]);

  // Auto-close when the inbox hits zero AFTER a successful in-session action.
  useEffect(() => {
    if (open && total === 0 && actedInSessionRef.current) {
      setOpen(false);
    }
  }, [open, total]);

  async function handleAction(d: Decision, action: "primary" | "secondary"): Promise<void> {
    if (!tenant) return;
    await dispatchDecisionAction(d.sourceRef, action, undefined, {
      queryClient,
      orgId: tenant.orgId,
      agentKey: d.agentKey,
    });
    actedInSessionRef.current = true;
  }

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
        {isLoading && !data ? (
          <p className="empty-state">
            <em>Reading your inbox…</em>
          </p>
        ) : isError ? (
          <p className="empty-state">
            <em>Couldn&apos;t load your inbox.</em>
          </p>
        ) : total === 0 ? (
          <p className="empty-state">
            <em>
              You&apos;re caught up across your team. I&apos;ll write again when something needs
              you.
            </em>
          </p>
        ) : (
          <div className="decisions" data-testid="inbox-list">
            {decisions.map((d, i) => {
              const card = mapToDecisionCard(d, i);
              const agent = AGENT_REGISTRY[d.agentKey];
              const agentName = agent?.displayName ?? d.agentKey;
              const folioWithAgent = {
                ...card.folio,
                kindLabel: `${agentName} · ${card.folio.kindLabel}`,
              };
              return (
                <div
                  key={d.id}
                  data-agent={d.agentKey}
                  className="inbox-item"
                  style={{ "--inbox-agent-accent": agent?.accent } as CSSProperties}
                >
                  <DecisionCard
                    {...card}
                    folio={folioWithAgent}
                    onPrimary={() => void handleAction(d, "primary")}
                    onSecondary={() => void handleAction(d, "secondary")}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
