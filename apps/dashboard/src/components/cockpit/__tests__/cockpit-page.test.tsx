// apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock data hooks before importing the page.
vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  usePendingApprovals: () => ({ data: { approvals: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-activity", () => ({
  useAgentActivity: () => ({ data: { roster: [], states: [], actions: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({ data: null, isLoading: false }),
}));

const toggleHaltMock = vi.fn();
let haltedState = false;

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({
    halted: haltedState,
    setHalted: vi.fn(),
    toggleHalt: toggleHaltMock,
  }),
}));

import { CockpitPage } from "../cockpit-page.js";

describe("CockpitPage", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    haltedState = false;
  });

  it("renders Topbar, Identity, and ActivityStream in the cold state", () => {
    render(<CockpitPage />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("IDLE")).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it("does not render ApprovalBlock when no pending approvals", () => {
    render(<CockpitPage />);
    expect(screen.queryByText(/Alex needs you/i)).not.toBeInTheDocument();
  });

  it("clicking the Halt button calls useHalt().toggleHalt()", () => {
    render(<CockpitPage />);
    fireEvent.click(screen.getByRole("button", { name: /halt/i }));
    expect(toggleHaltMock).toHaveBeenCalledOnce();
  });

  it("renders the HALTED status pill when useHalt() reports halted", () => {
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
    expect(screen.getByText(/Halted — resume to send instructions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("consumes the existing HaltProvider (does not re-root)", () => {
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
  });
});
