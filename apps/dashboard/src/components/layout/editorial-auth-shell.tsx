import type { ReactNode } from "react";
import { EditorialShellBoundary } from "./editorial-shell-boundary";
import { AmbientCream } from "./ambient-cream";
import { EditorialKeys } from "./editorial-keys";
import { LiveSignalPopover } from "./live-signal-popover";
import { InboxDrawer } from "./inbox-drawer";
import { HaltButtonClient } from "./halt/halt-button-client";
import { HaltProvider } from "./halt/halt-context";
import { RightDrawerProvider } from "./right-drawer-context";
import { ToolsOverflow } from "./tools-overflow";
import { TweaksPanelMount } from "./tweaks-panel-mount";
import { PrimaryNav } from "./primary-nav";

export { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";

export async function EditorialAuthShell({ children }: { children: ReactNode }) {
  return (
    <EditorialShellBoundary>
      <EditorialAuthShellInner>{children}</EditorialAuthShellInner>
    </EditorialShellBoundary>
  );
}

export function EditorialAuthShellInner({ children }: { children: ReactNode }) {
  return (
    <HaltProvider>
      <RightDrawerProvider>
        <AmbientCream />
        <EditorialKeys />
        <header className="app-header">
          <div className="app-header-row">
            <div className="brand-cluster">
              <a href="/" className="brand-mark">
                <span className="brand-dot" />
                Switchboard
              </a>
              <PrimaryNav />
            </div>
            <div className="header-actions">
              <LiveSignalPopover />
              <InboxDrawer />
              <HaltButtonClient />
              <span className="me-chip">M</span>
              <ToolsOverflow />
            </div>
          </div>
        </header>
        <main>{children}</main>
        <TweaksPanelMount />
      </RightDrawerProvider>
    </HaltProvider>
  );
}
