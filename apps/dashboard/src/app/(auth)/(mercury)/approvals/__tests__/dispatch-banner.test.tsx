import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DispatchBanner } from "../components/detail/dispatch-banner";

function visibleText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"], script, style').forEach((el) => el.remove());
  return clone.textContent ?? "";
}

describe("DispatchBanner", () => {
  it("renders 'Approved.' for kind=approved (single approver)", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" />);
    expect(screen.getByText(/^Approved\.$/)).toBeInTheDocument();
    expect(screen.getByText(/Alex is processing this now/)).toBeInTheDocument();
    expect(screen.getByText(/check\s+Activity/i)).toBeInTheDocument();
  });

  it("renders 'Approved with changes.' for kind=patched", () => {
    render(<DispatchBanner kind="patched" agentName="Alex" />);
    expect(screen.getByText(/^Approved with changes\.$/)).toBeInTheDocument();
  });

  it("renders 'Signed.' + quorum-waiting copy when awaitingQuorum > 0", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" awaitingQuorum={2} />);
    expect(screen.getByText(/^Signed\.$/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting on 2 more teammates/)).toBeInTheDocument();
  });

  it("uses singular 'teammate' when awaitingQuorum === 1", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" awaitingQuorum={1} />);
    expect(screen.getByText(/Waiting on 1 more teammate\./)).toBeInTheDocument();
  });

  it("renders 'Rejected.' copy for kind=rejected", () => {
    render(<DispatchBanner kind="rejected" agentName="Alex" />);
    expect(screen.getByText(/^Rejected\.$/)).toBeInTheDocument();
    expect(screen.getByText(/agent has been told to stand down/)).toBeInTheDocument();
  });

  it("contains no engineering vocabulary in visible text", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" />);
    expect(visibleText()).not.toMatch(
      /executable work unit|frozen for|idempotency|envelope|binding/i,
    );
  });
});
