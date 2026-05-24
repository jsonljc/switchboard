import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorialAuthShellInner } from "../editorial-auth-shell";

vi.mock("@/lib/api-client/agents-server", () => ({
  fetchEnabledAgentsServer: vi.fn().mockResolvedValue(["alex"]),
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
});
