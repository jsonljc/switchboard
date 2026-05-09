import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorialAuthShellInner } from "../editorial-auth-shell";

vi.mock("@/lib/api-client/agents-server", () => ({
  fetchEnabledAgentsServer: vi.fn().mockResolvedValue(["alex"]),
}));
vi.mock("../inbox-link-client", () => ({
  InboxLinkClient: () => (
    <button type="button" aria-disabled="true">
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

describe("EditorialAuthShellInner", () => {
  it("renders Home + only enabled agents in brand-nav", () => {
    render(
      <EditorialAuthShellInner enabledAgents={["alex", "riley"]}>
        <p>page</p>
      </EditorialAuthShellInner>,
    );
    expect(screen.getByRole("link", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /alex/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /riley/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /mira/i })).toBeNull();
  });

  it("renders the inbox link as aria-disabled (no navigation in slice B)", () => {
    render(
      <EditorialAuthShellInner enabledAgents={["alex"]}>
        <p>page</p>
      </EditorialAuthShellInner>,
    );
    const inbox = screen.getByRole("button", { name: /inbox/i });
    expect(inbox.getAttribute("aria-disabled")).toBe("true");
  });

  it("wraps the children in a <main>", () => {
    render(
      <EditorialAuthShellInner enabledAgents={["alex"]}>
        <p>page-content</p>
      </EditorialAuthShellInner>,
    );
    const content = screen.getByText("page-content");
    expect(content.closest("main")).not.toBeNull();
  });
});
