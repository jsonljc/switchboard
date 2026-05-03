"use client";

import "./console.css";
import { useState } from "react";
import { OpStrip } from "./zones/op-strip";
import { QueueZone } from "./zones/queue-zone";
import { AgentStrip } from "./zones/agent-strip";
import { NovaPanel } from "./zones/nova-panel";
import { ActivityTrail } from "./zones/activity-trail";
import { WelcomeBanner } from "./welcome-banner";
import { HelpOverlay } from "./help-overlay";
import { ToastShelf } from "./toast-shelf";
import { ToastProvider, useToast } from "./use-toast";
import { HaltProvider, toggleHaltWithToast, useHalt } from "./halt-context";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

function ConsoleViewInner() {
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
