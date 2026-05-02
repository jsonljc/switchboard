"use client";

import "./console.css";
import { useState } from "react";
import { OpStrip } from "./zones/op-strip";
import { NumbersStrip } from "./zones/numbers-strip";
import { QueueZone } from "./zones/queue-zone";
import { AgentStrip } from "./zones/agent-strip";
import { NovaPanel } from "./zones/nova-panel";
import { ActivityTrail } from "./zones/activity-trail";
import { HelpOverlay } from "./help-overlay";
import { ToastProvider } from "./use-toast";
import { ToastShelf } from "./toast-shelf";
import { ApprovalSlideOver } from "./slide-overs/approval-slide-over";
import { EscalationSlideOver } from "./slide-overs/escalation-slide-over";

type SlideOverState =
  | { kind: "approval"; approvalId: string; bindingHash: string }
  | { kind: "escalation"; escalationId: string }
  | null;

export function ConsoleView() {
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <ToastProvider>
      <div data-v6-console>
        <OpStrip onHelpOpen={() => setHelpOpen(true)} />
        <main className="console-main">
          <NumbersStrip />
          <QueueZone onOpenSlideOver={setSlideOver} />
          <AgentStrip />
          <NovaPanel />
          <ActivityTrail />
        </main>

        {slideOver?.kind === "approval" && (
          <ApprovalSlideOver
            approvalId={slideOver.approvalId}
            bindingHash={slideOver.bindingHash}
            open
            onOpenChange={(open) => {
              if (!open) setSlideOver(null);
            }}
          />
        )}

        {slideOver?.kind === "escalation" && (
          <EscalationSlideOver
            escalationId={slideOver.escalationId}
            open
            onOpenChange={(open) => {
              if (!open) setSlideOver(null);
            }}
          />
        )}

        {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
        <ToastShelf />
      </div>
    </ToastProvider>
  );
}
