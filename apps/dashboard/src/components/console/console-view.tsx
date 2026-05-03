"use client";

import "./console.css";
import { useState } from "react";
import { OpStrip } from "./zones/op-strip";
import { QueueZone } from "./zones/queue-zone";
import { AgentStrip } from "./zones/agent-strip";
import { NovaPanel } from "./zones/nova-panel";
import { ActivityTrail } from "./zones/activity-trail";
import { ApprovalSlideOver } from "./slide-overs/approval-slide-over";
import { EscalationSlideOver } from "./slide-overs/escalation-slide-over";
import { WelcomeBanner } from "./welcome-banner";
import { HelpOverlay } from "./help-overlay";
import { ToastShelf } from "./toast-shelf";
import { ToastProvider } from "./use-toast";
import { HaltProvider, toggleHaltWithToast, useHalt } from "./halt-context";
import { useToast } from "./use-toast";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

type SlideOverState =
  | { kind: "approval"; approvalId: string; bindingHash: string }
  | { kind: "escalation"; escalationId: string }
  | null;

function ConsoleViewInner() {
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const { halted, setHalted, toggleHalt } = useHalt();
  const { showToast } = useToast();

  useKeyboardShortcuts({
    help: () => setHelpOpen((v) => !v),
    halt: () => toggleHaltWithToast({ halted, setHalted, toggleHalt, showToast }),
    escape: () => setHelpOpen(false),
  });

  return (
    <div data-v6-console>
      <OpStrip onHelpOpen={() => setHelpOpen(true)} />
      <main className="console-main">
        <WelcomeBanner />
        <QueueZone />
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
  );
}

export function ConsoleView() {
  return (
    <ToastProvider>
      <HaltProvider>
        <ConsoleViewInner />
      </HaltProvider>
    </ToastProvider>
  );
}
