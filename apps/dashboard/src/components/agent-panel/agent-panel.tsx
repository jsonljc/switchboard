"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { InboxAgentAvatar } from "@/components/inbox/inbox-agent-avatar";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { MiraPanel } from "./mira-panel";
import { IdentityStatus } from "./identity-status";
import { KeyResult } from "./key-result";
import { OpenDecisions } from "./open-decisions";
import { WorkLog } from "./work-log";
import type { Decision } from "@/lib/decisions/types";
import styles from "./agent-panel.module.css";

export interface AgentPanelProps {
  agentKey: PanelAgentKey;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Called when the user taps a decision row in slot ③.
   * Host surfaces wire this to the decision-detail sheet.
   */
  onOpenDecision?: (decision: Decision) => void;
  /**
   * Called when the user taps "See all in Results →" in slot ④.
   * Host surfaces wire this to navigate to /results.
   */
  onSeeAll?: () => void;
}

/**
 * Self-contained agent-panel sheet.
 *
 * Drawer-ownership decision (Task 6 discovery):
 * The existing `RightDrawerKind` in `layout/right-drawer-context.tsx` is
 * `"inbox" | "opportunity"` — it is a dashboard-level context but its kind
 * union does NOT include agent-panel and is not designed for this surface.
 * The Inbox's `InboxDrawer` consumes it directly. Since the AgentPanel opens
 * from Home, Inbox, AND Results, coupling to that context would create an
 * Inbox/layout dependency for all three surfaces. Decision: AgentPanel is a
 * fully self-contained `Sheet` taking `agentKey/open/onOpenChange`; each host
 * surface owns its own local open-state. No changes to `right-drawer-context`.
 *
 * Slot composition (set-up agents only; Mira gets its own honest body):
 *   ① IdentityStatus — greeting segments, health+presence status line
 *   ② KeyResult      — lifetime/week hero, activation, paused composition
 *   ③ OpenDecisions  — decision list routing out to decision-detail sheet
 *   ④ WorkLog        — recent activity in first-person voice
 *   ⑤ Freshness foot — "as of {time}" (render-time stamp, per spec)
 *
 * One slot's error NEVER blanks the others — each slot owns its own
 * loading/error/empty branch. No panel-level error boundary.
 */
export function AgentPanel({
  agentKey,
  open,
  onOpenChange,
  onOpenDecision,
  onSeeAll,
}: AgentPanelProps) {
  const display = agentDisplay[agentKey];

  // Freshness foot: render-time clock formatted as h:mmap/pm (per spec —
  // "the panel's whole thesis is provenance over liveness"). We use the
  // render time so the stamp is never stale; a data asOf field could be
  // used if all four slots exposed one, but they don't — a unified render
  // clock is the correct honest answer here.
  const clockLabel = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={styles.panel}>
        <SheetHeader>
          <SheetTitle className={styles.idRow}>
            <InboxAgentAvatar agentKey={agentKey} size={44} />
            <span className={styles.agentName}>{display.name}</span>
            <span className={styles.role}>{display.role}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">{display.role}</SheetDescription>
        </SheetHeader>
        <div className={styles.body}>
          {agentKey === "mira" ? (
            <MiraPanel />
          ) : (
            <>
              {/* Slot ①: Identity + health/presence + verdict */}
              <IdentityStatus agentKey={agentKey} />
              {/* Slot ②: Key result hero (lifetime/week/activation/paused) */}
              <KeyResult agentKey={agentKey} />
              {/* Slot ③: Open decisions → routes out to decision-detail */}
              <OpenDecisions agentKey={agentKey} onOpenDecision={onOpenDecision ?? (() => {})} />
              {/* Slot ④: Recent work log → "See all in Results →" */}
              <WorkLog agentKey={agentKey} onSeeAll={onSeeAll} />
              {/* Freshness foot — single muted "as of {time}" line */}
              <p className={styles.freshnessFoot} data-testid="freshness-foot">
                as of {clockLabel}
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
