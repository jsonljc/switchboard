import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GovernanceGates, type GateCardModel } from "../governance-gates";

const ZERO = { wouldBlock: 0, wouldRewrite: 0, wouldEscalate: 0, wouldTemplate: 0, total: 0 };

function gate(over: Partial<GateCardModel> & Pick<GateCardModel, "unit">): GateCardModel {
  return {
    currentMode: "observe",
    ready: false,
    blockingReason: null,
    producer: { kind: "none", count: 0 },
    review: ZERO,
    ...over,
  };
}

describe("GovernanceGates", () => {
  it("disables Enforce and shows the blocking reason when a producer-gate is not ready", () => {
    render(
      <GovernanceGates
        pendingUnit={null}
        onFlip={vi.fn()}
        gates={[
          gate({
            unit: "deterministic",
            ready: false,
            blockingReason: "Add at least one approved service price before enforcing.",
            producer: { kind: "price", count: 0 },
          }),
        ]}
      />,
    );
    const btn = screen.getByRole("button", { name: /Enforce Banned phrases/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/approved service price/i)).toBeTruthy();
  });

  it("enables Enforce when ready, and confirming calls onFlip(unit, enforce)", () => {
    const onFlip = vi.fn();
    render(
      <GovernanceGates
        pendingUnit={null}
        onFlip={onFlip}
        gates={[
          gate({ unit: "deterministic", ready: true, producer: { kind: "price", count: 3 } }),
        ]}
      />,
    );
    const btn = screen.getByRole("button", { name: /Enforce Banned phrases/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    // Confirmation dialog opens; only on confirm does onFlip fire.
    expect(onFlip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-enforce"));
    expect(onFlip).toHaveBeenCalledWith("deterministic", "enforce");
  });

  it("consent enforce is enabled even with zero producers (fail-safe gate)", () => {
    render(
      <GovernanceGates
        pendingUnit={null}
        onFlip={vi.fn()}
        gates={[gate({ unit: "consent", ready: true, producer: { kind: "none", count: 0 } })]}
      />,
    );
    expect(screen.getByRole("button", { name: /Enforce PDPA consent/i })).not.toBeDisabled();
  });

  it("an enforcing gate shows an always-enabled rollback that calls onFlip(unit, observe)", () => {
    const onFlip = vi.fn();
    render(
      <GovernanceGates
        pendingUnit={null}
        onFlip={onFlip}
        gates={[gate({ unit: "claims", currentMode: "enforce", ready: false })]}
      />,
    );
    const rollback = screen.getByRole("button", { name: /Return to observe/i });
    expect(rollback).not.toBeDisabled(); // rollback never gated
    fireEvent.click(rollback);
    expect(onFlip).toHaveBeenCalledWith("claims", "observe");
  });

  it("shows the observe would-act counts", () => {
    render(
      <GovernanceGates
        pendingUnit={null}
        onFlip={vi.fn()}
        gates={[
          gate({
            unit: "deterministic",
            review: {
              wouldBlock: 7,
              wouldRewrite: 0,
              wouldEscalate: 0,
              wouldTemplate: 0,
              total: 7,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/would have blocked 7/i)).toBeTruthy();
  });
});
