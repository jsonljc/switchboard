/**
 * AgentPanel shell tests — pure shell concerns only.
 *
 * The four data-slots (IdentityStatus, KeyResult, OpenDecisions, WorkLog) each
 * call real hooks (useAgentGreeting, useAgentMetrics, useDecisionFeed, …).
 * Mounting them here would require a full QueryClientProvider + per-hook mocks
 * identical to the slot unit tests — that's a slot test responsibility, not a
 * shell test responsibility.
 *
 * Decision: mock the four slot COMPONENTS so the shell tests stay focused on:
 *   - dialog/role presence when open
 *   - close button (Radix Sheet a11y contract)
 *   - MiraPanel body for agentKey="mira" (no data-slot scaffold)
 *
 * State-matrix integration tests (all hooks mocked, full assembly) live in
 * agent-panel.matrix.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock slot components ─────────────────────────────────────────────────────
// Each slot is replaced with a trivial stub. The stubs carry data-testid
// attributes so the Mira test can assert they are NOT present.

vi.mock("../identity-status", () => ({
  IdentityStatus: ({ agentKey }: { agentKey: string }) => (
    <div data-testid="slot-identity-status" data-agent-key={agentKey} />
  ),
}));

vi.mock("../key-result", () => ({
  KeyResult: ({ agentKey }: { agentKey: string }) => (
    <div data-testid="slot-key-result" data-agent-key={agentKey} />
  ),
}));

vi.mock("../open-decisions", () => ({
  OpenDecisions: ({ agentKey }: { agentKey: string }) => (
    <div data-testid="slot-open-decisions" data-agent-key={agentKey} />
  ),
}));

vi.mock("../work-log", () => ({
  WorkLog: ({ agentKey }: { agentKey: string }) => (
    <div data-testid="slot-work-log" data-agent-key={agentKey} />
  ),
}));

// Mock InboxAgentAvatar — avoids sprite/canvas setup
vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

// Mock next/navigation and use-mira-enabled so MiraPanel renders in a non-Next env
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-mira-enabled", () => ({
  useMiraEnabled: () => ({ enabled: false, isLoading: false }),
}));
// useIsDesktop drives the Sheet `side` (right on desktop, bottom otherwise).
// Default false so the other shell tests render the unchanged bottom sheet.
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: vi.fn(() => false) }));

// Import component after mocks
import { AgentPanel } from "@/components/agent-panel/agent-panel";
import { useIsDesktop } from "@/hooks/use-is-desktop";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentPanel shell", () => {
  it("renders the dialog with the agent name when open", () => {
    render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });

  it("exposes a reachable close control (Radix Sheet a11y contract)", () => {
    render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("renders the MiraPanel body (not the data-slot scaffold) for agentKey 'mira'", () => {
    render(<AgentPanel agentKey="mira" open onOpenChange={() => {}} />);
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
    // Data slots must NOT appear in the Mira branch
    expect(screen.queryByTestId("slot-identity-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slot-key-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slot-open-decisions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slot-work-log")).not.toBeInTheDocument();
  });

  it("docks as a right side-panel on desktop, bottom sheet otherwise", () => {
    vi.mocked(useIsDesktop).mockReturnValue(true);
    const { rerender } = render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    // side="right" → Radix Content carries the right-edge variant classes
    expect(screen.getByRole("dialog").className).toContain("right-0");

    vi.mocked(useIsDesktop).mockReturnValue(false);
    rerender(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog").className).toContain("bottom-0");
  });
});
