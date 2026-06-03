import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConnectionTrouble, AllClear, AgentPaused } from "./states";

afterEach(cleanup);

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

describe("ConnectionTrouble", () => {
  it("online: API-down copy + retry", () => {
    setOnline(true);
    const onRetry = vi.fn();
    render(<ConnectionTrouble onRetry={onRetry} />);
    expect(screen.getByText(/can't reach your team/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing you've approved is lost/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it("offline: hold-decisions copy, no retry button", () => {
    setOnline(false);
    render(<ConnectionTrouble onRetry={vi.fn()} />);
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
    expect(screen.getByText(/hold your decisions/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    setOnline(true);
  });
  it("names a specific agent", () => {
    setOnline(true);
    render(<ConnectionTrouble agentName="Riley" />);
    expect(screen.getByText(/can't reach Riley/i)).toBeInTheDocument();
  });
});

describe("AllClear", () => {
  it("default all-clear copy", () => {
    render(<AllClear />);
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByText(/on top of it/i)).toBeInTheDocument();
  });
  it("override sub-line", () => {
    render(<AllClear sub="Nothing waiting from Mira." />);
    expect(screen.getByText(/nothing waiting from mira/i)).toBeInTheDocument();
  });
});

describe("AgentPaused", () => {
  it("names the agent + nothing-goes-out copy", () => {
    render(<AgentPaused agentName="Mira" />);
    expect(screen.getByText(/Mira is paused/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing new will go out/i)).toBeInTheDocument();
  });
});
