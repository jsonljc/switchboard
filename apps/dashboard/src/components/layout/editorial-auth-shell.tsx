import type { ReactNode } from "react";
import type { AgentKey } from "@switchboard/schemas";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialShellBoundary } from "./editorial-shell-boundary";
import { AmbientCream } from "./ambient-cream";
import { EditorialKeys } from "./editorial-keys";
import { LiveSignalPopover } from "./live-signal-popover";
import { InboxLinkClient } from "./inbox-link-client";
import { HaltButtonClient } from "./halt/halt-button-client";
import { HaltProvider } from "./halt/halt-context";
import { TweaksPanelMount } from "./tweaks-panel-mount";

export async function EditorialAuthShell({ children }: { children: ReactNode }) {
  const enabledAgents = await fetchEnabledAgentsServer();
  return (
    <EditorialShellBoundary>
      <EditorialAuthShellInner enabledAgents={enabledAgents}>{children}</EditorialAuthShellInner>
    </EditorialShellBoundary>
  );
}

export function EditorialAuthShellInner({
  enabledAgents,
  children,
}: {
  enabledAgents: readonly AgentKey[];
  children: ReactNode;
}) {
  return (
    <HaltProvider>
      <AmbientCream />
      <EditorialKeys />
      <header className="app-header">
        <div className="app-header-row">
          <div className="brand-cluster">
            <a href="/" className="brand-mark">
              <span className="brand-dot" />
              Switchboard
            </a>
            <nav className="brand-nav" aria-label="agents">
              <a href="/">Home</a>
              {enabledAgents.map((key) => (
                <a key={key} href={`/${key}`}>
                  {AGENT_REGISTRY[key].displayName}
                </a>
              ))}
              <a href="#" className="add" aria-label="Add an agent">
                +
              </a>
            </nav>
          </div>
          <div className="header-actions">
            <LiveSignalPopover />
            <InboxLinkClient />
            <HaltButtonClient />
            <span className="me-chip">M</span>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <TweaksPanelMount />
    </HaltProvider>
  );
}
