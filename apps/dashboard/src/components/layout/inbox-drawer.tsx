"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
import { ConfirmSheet } from "@/components/decisions/swipe-decision-card";
import { QueryStates } from "@/components/query-states";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";
import { needsConfirm } from "@/lib/decisions/swipe-policy";
import type { Decision } from "@/lib/decisions/types";
import { useRightDrawer } from "./right-drawer-context";
import "./inbox-drawer.css";

/**
 * Subtitle copy for the drawer header. Derived from {hasData, error} so it is
 * keys-pending-safe: a disabled query reports isLoading:false with no data, so
 * a `isLoading`-based gate would false-show "You're caught up." Mirror the body
 * precedence (data ▸ error ▸ reading) instead.
 */
function describeTotal(total: number, hasData: boolean, isError: boolean): string {
  if (!hasData) return isError ? "Couldn't load." : "Reading…";
  if (total === 0) return "You're caught up.";
  return `${total} pending across your team.`;
}

/**
 * Tracks a pending confirm-gated approval. When the user taps the primary
 * action on an approval decision that `needsConfirm`, we capture the decision
 * here instead of committing immediately. ConfirmSheet is rendered once at the
 * drawer level (not per-card) to avoid a hooks-in-loop violation.
 */
interface PendingConfirm {
  decision: Decision;
  agentName: string;
}

export function InboxDrawer() {
  const drawer = useRightDrawer();
  const open = drawer.kind === "inbox";
  const setOpen = (next: boolean) => (next ? drawer.open("inbox") : drawer.close());
  const feedQuery = useDecisionFeed(null);
  const { data, isError } = feedQuery;
  const tenant = useTenantContext();
  const queryClient = useQueryClient();

  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  const actedInSessionRef = useRef(false);
  // Confirm-gate: holds the pending approval when needsConfirm is true.
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

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

  async function commitAction(d: Decision, action: "primary" | "secondary"): Promise<void> {
    if (!tenant) return;
    await dispatchDecisionAction(d.sourceRef, action, undefined, {
      queryClient,
      orgId: tenant.orgId,
      agentKey: d.agentKey,
    });
    actedInSessionRef.current = true;
  }

  /**
   * Risk-gated primary handler for approval decisions:
   * - When `needsConfirm(riskContract)` is true, capture in pendingConfirm
   *   and let ConfirmSheet gate the actual commit.
   * - Otherwise commit immediately (low-risk path, identical to before).
   *
   * Handoff primary actions are never approval-committable (see NeedsYouCard
   * spec §3) — the gate is not applied to handoffs; they dispatch directly.
   */
  function handleAction(d: Decision, action: "primary" | "secondary"): void {
    if (action === "primary" && d.kind === "approval" && needsConfirm(d.meta.riskContract)) {
      const agent = AGENT_REGISTRY[d.agentKey];
      setPendingConfirm({ decision: d, agentName: agent?.displayName ?? d.agentKey });
      return;
    }
    void commitAction(d, action);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="folio-link"
            disabled={!tenantReady}
            aria-label={
              total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"
            }
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
            <SheetDescription>{describeTotal(total, data != null, isError)}</SheetDescription>
          </SheetHeader>
          <QueryStates
            query={feedQuery}
            isEmpty={(d) => d.counts.total === 0}
            loading={
              <p className="empty-state">
                <em>Reading your inbox…</em>
              </p>
            }
            error={
              <p className="empty-state">
                <em>Couldn&apos;t load your inbox.</em>
              </p>
            }
            empty={
              <p className="empty-state">
                <em>
                  You&apos;re caught up across your team. I&apos;ll write again when something needs
                  you.
                </em>
              </p>
            }
          >
            {(feed) => (
              <div className="decisions" data-testid="inbox-list">
                {feed.decisions.map((d, i) => {
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
                        onPrimary={() => handleAction(d, "primary")}
                        onSecondary={() => void commitAction(d, "secondary")}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </QueryStates>
        </SheetContent>
      </Sheet>

      {/* Confirm-gate: rendered outside Sheet so it is not clipped by the drawer overlay. */}
      <ConfirmSheet
        open={pendingConfirm !== null}
        agentName={pendingConfirm?.agentName ?? ""}
        summary={pendingConfirm?.decision.humanSummary ?? ""}
        affirmativeLabel={pendingConfirm?.decision.presentation.primaryLabel ?? ""}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const pending = pendingConfirm;
          setPendingConfirm(null);
          if (pending) void commitAction(pending.decision, "primary");
        }}
      />
    </>
  );
}
