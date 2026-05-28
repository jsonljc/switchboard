"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { AgentKey } from "@switchboard/schemas";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { InboxFilterRow } from "@/components/inbox/inbox-filter-row";
import { InboxEmptyState } from "@/components/inbox/inbox-empty-state";
import { InboxErrorState } from "@/components/inbox/inbox-error-state";
import { InboxDecisionItem } from "@/components/inbox/inbox-decision-item";
import { ApprovalDetailSheet } from "@/components/inbox/approval-detail-sheet";
import { AgentPanel } from "@/components/agent-panel/agent-panel";
import type { PanelAgentKey } from "@/components/agent-panel/lib/agent-display";
import type { Decision, DecisionKind } from "@/lib/decisions/types";

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

// ── InboxScreen ───────────────────────────────────────────────────────────────

export function InboxScreen() {
  const router = useRouter();
  const [agentFilter, setAgentFilter] = useState<AgentKey | null>(null);
  const [open, setOpen] = useState<{ decision: Decision; kind: DecisionKind } | null>(null);
  const [panelAgent, setPanelAgent] = useState<PanelAgentKey | null>(null);

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

  if (filtered.isLoading) {
    return <div className="inbox-loading">Loading…</div>;
  }

  const decisions = filtered.data?.decisions ?? [];

  return (
    <>
      <InboxFilterRow counts={counts} selected={agentFilter} onSelect={setAgentFilter} />

      {decisions.length === 0 ? (
        <InboxEmptyState
          filtered={agentFilter !== null}
          agentName={agentFilter ? AGENT_REGISTRY[agentFilter]?.displayName : undefined}
        />
      ) : (
        <ul className="inbox-list">
          {decisions.map((d) => (
            <li key={d.id} className="inbox-row">
              <InboxDecisionItem
                decision={d}
                onOpenDetail={(dec) => setOpen({ decision: dec, kind: dec.kind })}
                onOpenAgent={setPanelAgent}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Detail layer */}
      {open?.kind === "approval" && (
        <ApprovalDetailItem decision={open.decision} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "handoff" && (
        <div className="inbox-handoff-guard">Handoff detail coming next.</div>
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
        />
      )}
    </>
  );
}
