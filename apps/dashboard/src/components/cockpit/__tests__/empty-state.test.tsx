// apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState, shouldRenderEmptyState } from "../empty-state";
import { ALEX_VARIANTS } from "../sprite/alex-variants";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const setupAllUndone: MissionAggregatorResponse["setup"] = [
  { key: "meta", done: false, primary: true },
  { key: "inbox", done: false },
  { key: "cal", done: false },
  { key: "rules", done: false },
];

const setupPartialDone: MissionAggregatorResponse["setup"] = [
  { key: "meta", done: true },
  { key: "inbox", done: false, primary: true },
  { key: "cal", done: false },
  { key: "rules", done: false },
];

describe("shouldRenderEmptyState", () => {
  it("returns true only when every setup row is undone", () => {
    expect(shouldRenderEmptyState(setupAllUndone)).toBe(true);
    expect(shouldRenderEmptyState(setupPartialDone)).toBe(false);
    expect(shouldRenderEmptyState([])).toBe(false);
  });
});

describe("EmptyState", () => {
  it("templates thresholds from mission.rules when present", () => {
    render(
      <EmptyState
        rules={{ priceApprovalThreshold: 120, refundEscalationFloor: 250 }}
        setup={setupAllUndone}
        onConnect={vi.fn()}
      />,
    );
    expect(screen.getByText(/pricing decisions over \$120/i)).toBeInTheDocument();
    expect(screen.getByText(/refunds over \$250/i)).toBeInTheDocument();
  });

  it("falls back to locked-design defaults when rules == null", () => {
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={vi.fn()} />);
    expect(screen.getByText(/pricing decisions over \$89/i)).toBeInTheDocument();
    expect(screen.getByText(/refunds over \$200/i)).toBeInTheDocument();
  });

  it("renders 4 setup rows with the primary row highlighted", () => {
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={vi.fn()} />);
    const rows = screen.getAllByTestId(/^setup-row-/);
    expect(rows).toHaveLength(4);
    const primary = screen.getByTestId("setup-row-meta");
    expect(primary.getAttribute("data-primary")).toBe("true");
    expect(screen.getByTestId("setup-row-inbox").getAttribute("data-primary")).toBe("false");
  });

  it("invokes onConnect with the row key when a setup row's Connect button is clicked", () => {
    const onConnect = vi.fn();
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={onConnect} />);
    // The primary row uses "Connect →"; non-primary uses "Connect".
    fireEvent.click(screen.getAllByRole("button", { name: /^Connect$/i })[0]!);
    // First non-primary in setupAllUndone is "inbox"
    expect(onConnect).toHaveBeenCalledWith("inbox");
  });

  it("primary row uses 'Connect →' label", () => {
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Connect →/i })).toBeInTheDocument();
  });

  it("shows the NEXT MOVE pill from the primary row", () => {
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={vi.fn()} />);
    const pill = screen.getByTestId("next-move-pill");
    expect(pill).toHaveTextContent(/NEXT MOVE/i);
    // Sibling text node carries the connect label
    const wrapper = pill.parentElement;
    expect(wrapper?.textContent).toMatch(/Connect Meta Ads/i);
  });

  it("shows 'Setup · X of N ready' counter eyebrow", () => {
    render(<EmptyState rules={null} setup={setupPartialDone} onConnect={vi.fn()} />);
    expect(screen.getByText(/Setup · 1 of 4 ready/i)).toBeInTheDocument();
  });

  it("done row hides the Connect button", () => {
    render(<EmptyState rules={null} setup={setupPartialDone} onConnect={vi.fn()} />);
    // setupPartialDone has 'meta' done — Connect buttons count = 3 (one per remaining)
    const connectButtons = screen.getAllByRole("button", { name: /Connect/i });
    expect(connectButtons).toHaveLength(3);
  });

  it("renders a sprite SVG in the narrator block when bundle is provided", () => {
    const { container } = render(
      <EmptyState
        rules={null}
        setup={[{ key: "meta", done: false, primary: true }]}
        onConnect={() => {}}
        bundle={ALEX_VARIANTS}
        variant="classic"
      />,
    );
    // The 48px sprite frame is the first <svg> inside the narrator block.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the literal 'A' letter when bundle is omitted (current behavior)", () => {
    const { getByText } = render(
      <EmptyState
        rules={null}
        setup={[{ key: "meta", done: false, primary: true }]}
        onConnect={() => {}}
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
  });
});
