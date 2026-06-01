import type { ReactNode } from "react";
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
import { AccountMenu } from "./account-menu";
import { AppSidebar } from "./app-sidebar";

/**
 * The single editorial shell. Mounted exactly once by AppShell (the (auth)
 * layout's client shell), so every authed route — except chrome-free flows
 * like /onboarding — shares this header + providers. It owns HaltProvider +
 * RightDrawerProvider (context), AmbientCream + EditorialKeys (one mount each),
 * the app-header, and the wrapping <main>. EditorialShellBoundary wraps this in
 * AppShell to catch render errors.
 */
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
              <span className="hide-at-lg">
                <PrimaryNav />
              </span>
            </div>
            <div className="header-actions">
              <LiveSignalPopover />
              <InboxDrawer />
              <HaltButtonClient />
              <AccountMenu />
              <span className="hide-at-lg">
                <ToolsOverflow />
              </span>
            </div>
          </div>
        </header>
        <div className="app-body">
          <AppSidebar />
          <main className="app-main">
            <div className="app-content">{children}</div>
          </main>
        </div>
        <TweaksPanelMount />
      </RightDrawerProvider>
    </HaltProvider>
  );
}
