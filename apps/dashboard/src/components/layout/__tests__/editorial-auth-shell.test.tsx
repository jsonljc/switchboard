import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorialAuthShellInner } from "../editorial-auth-shell";

// Tool A: stub use-governance so HaltProvider mounts without QueryClient/SessionProvider.
// data: undefined prevents the server-sync useEffect from overriding local state.
vi.mock("@/hooks/use-governance", () => ({
  useGovernanceStatus: () => ({ data: undefined, isLoading: false }),
  useEmergencyHalt: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useResume: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock("../inbox-drawer", () => ({
  InboxDrawer: () => (
    <button type="button" className="folio-link">
      Inbox
    </button>
  ),
}));
vi.mock("../halt/halt-button-client", () => ({
  HaltButtonClient: () => <button type="button">Halt</button>,
}));
vi.mock("../ambient-cream", () => ({
  AmbientCream: () => null,
}));
vi.mock("../tweaks-panel-mount", () => ({
  TweaksPanelMount: () => null,
}));
vi.mock("../live-signal-popover", () => ({
  LiveSignalPopover: () => (
    <button type="button" className="live-pip">
      <span className="pulse" />
      Live
    </button>
  ),
}));
vi.mock("../primary-nav", () => ({
  PrimaryNav: () => (
    <nav aria-label="Primary">
      <a href="/">Home</a>
      <a href="/inbox">Inbox</a>
      <a href="/results">Results</a>
    </nav>
  ),
}));
// Stub the menu children: both depend on react-query/session providers the shell
// test intentionally does not mount (same rationale as the use-governance stub).
vi.mock("../tools-overflow", () => ({
  ToolsOverflow: () => <button type="button">Tools</button>,
}));
vi.mock("../account-menu", () => ({
  AccountMenu: () => (
    <button type="button" aria-label="Account menu">
      M
    </button>
  ),
}));
vi.mock("../app-sidebar", () => ({
  AppSidebar: () => <nav aria-label="Primary sidebar" />,
}));

describe("EditorialAuthShellInner", () => {
  it("renders primary nav with inbox link and no per-agent links", () => {
    render(
      <EditorialAuthShellInner>
        <p>page</p>
      </EditorialAuthShellInner>,
    );
    expect(screen.getByRole("link", { name: /inbox/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^alex$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^riley$/i })).toBeNull();
  });

  it("renders an inbox trigger with the folio-link header contract", () => {
    render(
      <EditorialAuthShellInner>
        <p>page</p>
      </EditorialAuthShellInner>,
    );
    const inbox = screen.getByRole("button", { name: /inbox/i });
    expect(inbox.className).toContain("folio-link");
  });

  it("wraps the children in a <main>", () => {
    render(
      <EditorialAuthShellInner>
        <p>page-content</p>
      </EditorialAuthShellInner>,
    );
    const content = screen.getByText("page-content");
    expect(content.closest("main")).not.toBeNull();
  });

  // The in-shell error boundary must scope to the CONTENT slot only. A render
  // error in a page must NOT strand the user with no header/nav — the boundary
  // catches the content, the shell chrome (brand, primary nav) stays mounted.
  it("keeps the header + nav mounted when page content throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): never {
      throw new Error("content-render-error");
    }
    render(
      <EditorialAuthShellInner>
        <Boom />
      </EditorialAuthShellInner>,
    );

    // Shell chrome survives the content error: the brand link and the primary
    // nav (exact "Primary" name; AppSidebar uses "Primary sidebar") stay mounted.
    expect(screen.getByRole("link", { name: /switchboard/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    // Content slot shows the recovery fallback, not the raw thrown error.
    expect(screen.getByText(/reload the page to try again/i)).toBeInTheDocument();
    spy.mockRestore();
  });
});
