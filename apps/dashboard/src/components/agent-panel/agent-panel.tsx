"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InboxAgentAvatar } from "@/components/inbox/inbox-agent-avatar";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { MiraPanel } from "./mira-panel";
import styles from "./agent-panel.module.css";

export interface AgentPanelProps {
  agentKey: PanelAgentKey;
  open: boolean;
  onOpenChange: (next: boolean) => void;
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
 */
export function AgentPanel({ agentKey, open, onOpenChange }: AgentPanelProps) {
  const display = agentDisplay[agentKey];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={styles.panel}>
        <SheetHeader>
          <SheetTitle className={styles.idRow}>
            <InboxAgentAvatar agentKey={agentKey} size={44} />
            <span className={styles.agentName}>{display.name}</span>
            <span className={styles.role}>{display.role}</span>
          </SheetTitle>
        </SheetHeader>
        <div className={styles.body}>
          {agentKey === "mira" ? <MiraPanel /> : <div data-testid="agent-panel-body" />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
