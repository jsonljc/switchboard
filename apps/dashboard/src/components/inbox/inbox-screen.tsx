"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { AgentKey } from "@switchboard/schemas";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { useEscalationReply } from "@/hooks/use-escalation-reply";
import { useEscalationResolve } from "@/hooks/use-escalation-resolve";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { InboxFilterRow } from "@/components/inbox/inbox-filter-row";
import { InboxEmptyState } from "@/components/inbox/inbox-empty-state";
import { InboxErrorState } from "@/components/inbox/inbox-error-state";
import { InboxDecisionItem } from "@/components/inbox/inbox-decision-item";
import { ApprovalDetailSheet } from "@/components/inbox/approval-detail-sheet";
import { AgentPanel } from "@/components/agent-panel/agent-panel";
import type { PanelAgentKey } from "@/components/agent-panel/lib/agent-display";
import { HandoffDetailSheet } from "@/components/inbox/handoff-detail-sheet";
import type { Decision, DecisionKind } from "@/lib/decisions/types";
import "./inbox-design-base.css";
import "./inbox.css";

// ── ApprovalDetailItem ────────────────────────────────────────────────────────
// Internal component — mounted ONLY when an approval detail is open, so its
// hook is never conditional-in-a-loop.

interface ApprovalDetailItemProps {
  decision: Decision;
  onClose: () => void;
}

function ApprovalDetailItem({ decision, onClose }: ApprovalDetailItemProps) {
  const { toast } = useToast();
  const action = useRecommendationAction(decision.sourceRef.sourceId);

  const handleCommit = (note?: string) => {
    if (action.isPending) return;
    void action
      .primary(note)
      .then((result: unknown) => {
        onClose();
        // 409 → silent path, no toast
        if (result && typeof result === "object" && "silent" in result) return;
        toast({
          title: "Approved",
          description: decision.meta.contactName
            ? `Sent for ${decision.meta.contactName}.`
            : undefined,
          action: (
            <ToastAction altText="Undo" onClick={() => void action.undo().catch(() => {})}>
              Undo
            </ToastAction>
          ),
        });
      })
      .catch(() => {}); // swallow so success toast never fires on rejection
  };

  const handleSecondary = () => {
    if (action.isPending) return;
    void action
      .secondary()
      .then(onClose)
      .catch(() => {});
  };

  const handleDismiss = () => {
    if (action.isPending) return;
    void action
      .dismiss()
      .then(onClose)
      .catch(() => {});
  };

  return (
    <ApprovalDetailSheet
      decision={decision}
      onClose={onClose}
      onCommit={handleCommit}
      onSecondary={handleSecondary}
      onDismiss={handleDismiss}
    />
  );
}

// ── HandoffDetailItem ──────────────────────────────────────────────────────────
// Mounted ONLY when a handoff detail is open — owns the reply/resolve hooks +
// toasts + decision-feed invalidation, so the sheet stays presentational and no
// hook runs inside the list loop. Mirrors ApprovalDetailItem.

interface HandoffDetailItemProps {
  decision: Decision;
  onClose: () => void;
}

function HandoffDetailItem({ decision, onClose }: HandoffDetailItemProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const escalationId = decision.sourceRef.sourceId;
  const reply = useEscalationReply(escalationId);
  const resolve = useEscalationResolve(escalationId);

  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;

  const invalidateFeed = () => {
    if (keys) void queryClient.invalidateQueries({ queryKey: keys.decisions.all() });
  };

  const handleReply = async (message: string): Promise<{ delivered: boolean }> => {
    const result = await reply.send(message); // { ok, escalation, error? } — ok:false = 502; a true error rejects
    invalidateFeed(); // the escalation is released on both 200 and 502
    if (result.ok) {
      toast({ title: "Handed back", description: `${agentName} stopped replying.` });
    } else {
      toast({
        title: "Saved — not delivered",
        description: "We couldn't deliver the reply right now.",
      });
    }
    return { delivered: result.ok };
  };

  const handleResolve = async (resolutionNote?: string): Promise<void> => {
    await resolve.resolve(resolutionNote);
    invalidateFeed();
    toast({ title: "Marked resolved" });
  };

  return (
    <HandoffDetailSheet
      decision={decision}
      onReply={handleReply}
      onResolve={handleResolve}
      onClose={onClose}
    />
  );
}

// ── InboxScreen ───────────────────────────────────────────────────────────────

export function InboxScreen() {
  const router = useRouter();
  const [agentFilter, setAgentFilter] = useState<AgentKey | null>(null);
  const [open, setOpen] = useState<{ decision: Decision; kind: DecisionKind } | null>(null);
  const [panelAgent, setPanelAgent] = useState<PanelAgentKey | null>(null);

  // Esc closes the open detail sheet (aria-modal dialog convention).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Both feeds: filtered drives the list; unfiltered drives per-agent counts.
  // TanStack dedupes by query key so both are safe.
  const filtered = useDecisionFeed(agentFilter);
  const all = useDecisionFeed(null);

  // Per-agent counts derived from the UNFILTERED feed's decisions
  const unfiltered = all.data?.decisions ?? [];
  const counts = { total: unfiltered.length } as { total: number } & Partial<
    Record<AgentKey, number>
  >;
  for (const d of unfiltered) {
    counts[d.agentKey] = (counts[d.agentKey] ?? 0) + 1;
  }

  // Render order: isError BEFORE empty (regression guard — must hold)
  if (filtered.isError) {
    return <InboxErrorState onRetry={filtered.refetch} />;
  }

  // Gate on (!data && !error), NOT isLoading. useDecisionFeed has `enabled: !!keys`,
  // so a keys-pending query is DISABLED — isLoading is false, data undefined,
  // isError false — and gating on isLoading would fall through and flash a false
  // inbox-zero ("That's everything") with items still pending. Mirrors the proven
  // fix at mira-desk-page.tsx. See feedback_react_query_enabled_false_isloading.
  if (!filtered.data && !filtered.isError) {
    return <div className="inbox-loading">Loading…</div>;
  }

  const decisions = filtered.data?.decisions ?? [];

  return (
    <div className="inbox-page">
      <div className="inbox-list">
        <header className="inbox-pagehead">
          <h1>inbox</h1>
          <span className="inbox-pagehead-count">
            {counts.total === 0
              ? "That's everything"
              : `${counts.total} ${counts.total === 1 ? "thing needs" : "things need"} you`}
          </span>
        </header>
        <InboxFilterRow counts={counts} selected={agentFilter} onSelect={setAgentFilter} />

        {decisions.length === 0 ? (
          <InboxEmptyState
            filtered={agentFilter !== null}
            agentName={agentFilter ? AGENT_REGISTRY[agentFilter]?.displayName : undefined}
          />
        ) : (
          <div className="inbox-queue">
            {decisions.map((d) => (
              <InboxDecisionItem
                key={d.id}
                decision={d}
                onOpenDetail={(dec) => setOpen({ decision: dec, kind: dec.kind })}
                onOpenAgent={setPanelAgent}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop docked-detail placeholder — display:none below lg, so mobile is unaffected */}
      {!open && (
        <div className="inbox-detail-empty" aria-hidden="true">
          Select an item to see details
        </div>
      )}

      {/* Detail layer (scrim hidden at lg; sheets dock into the right pane at lg) */}
      {open && (
        <div className="scrim" data-open="true" aria-hidden="true" onClick={() => setOpen(null)} />
      )}
      {open?.kind === "approval" && (
        <ApprovalDetailItem decision={open.decision} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "handoff" && (
        <HandoffDetailItem decision={open.decision} onClose={() => setOpen(null)} />
      )}

      {/* Agent panel — decoupled local state, mirrors Home's pattern */}
      {panelAgent && (
        <AgentPanel
          key={panelAgent}
          agentKey={panelAgent}
          open
          onOpenChange={(o) => {
            if (!o) setPanelAgent(null);
          }}
          // From Inbox, "see all results" navigates to /results; decision already in context
          onSeeAll={() => router.push("/results")}
          // From Inbox, "open decision" is a no-op navigation (already on inbox surface)
          onOpenDecision={() => router.push("/inbox")}
          onActivate={() => router.push("/settings/channels")}
        />
      )}
    </div>
  );
}
