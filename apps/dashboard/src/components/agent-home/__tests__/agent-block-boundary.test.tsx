import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentBlockBoundary } from "../agent-block-boundary";

function Boom() {
  throw new Error("kaboom");
}

describe("AgentBlockBoundary", () => {
  it("catches a render error and shows the fallback", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AgentBlockBoundary>
        <Boom />
      </AgentBlockBoundary>,
    );
    expect(screen.getByText(/couldn't load this block/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when there is no error", () => {
    render(
      <AgentBlockBoundary>
        <p>fine</p>
      </AgentBlockBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
  });
});
