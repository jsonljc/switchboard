import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "../empty-state.js";

describe("EmptyState — zero variant", () => {
  it("renders eyebrow, italic-accent headline, ledger-health prose, and the writer-connected metadata", () => {
    render(<EmptyState variant="zero" />);
    expect(screen.getByText(/ledger health/i)).toBeInTheDocument();
    expect(screen.getByText(/No activity/)).toBeInTheDocument();
    expect(screen.getByText("recorded yet")).toBeInTheDocument();
    expect(screen.getByText("recorded yet").tagName.toLowerCase()).toBe("em");
    expect(screen.getByText(/chain is healthy and the writer is connected/i)).toBeInTheDocument();
    expect(screen.getByText(/writer connected/i)).toBeInTheDocument();
    expect(screen.getByText(/chain head verified/i)).toBeInTheDocument();
    expect(screen.queryByText(/last recorded/i)).toBeNull();
  });
});

describe("EmptyState — filtered variant", () => {
  it("renders eyebrow, italic-accent headline, scanned-count prose, and Clear CTA", async () => {
    const onClear = vi.fn();
    render(<EmptyState variant="filtered" scannedCount={30} onClear={onClear} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    expect(screen.getByText(/No entries match/)).toBeInTheDocument();
    expect(screen.getByText("these filters")).toBeInTheDocument();
    expect(screen.getByText("these filters").tagName.toLowerCase()).toBe("em");
    expect(screen.getByText(/We checked 30 entries across the current scope/)).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: /Clear filters/ });
    await userEvent.setup().click(cta);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not render the Clear CTA when onClear is undefined", () => {
    render(<EmptyState variant="filtered" scannedCount={30} />);
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
  });

  it("suppresses the 'switch to All events' suggestion when scope is already 'all'", () => {
    render(<EmptyState variant="filtered" scannedCount={30} scope="all" />);
    // Suggestion text should be gone; "All events" emphasis no longer rendered.
    expect(screen.queryByText("All events")).toBeNull();
    expect(screen.queryByText(/non-operational types/)).toBeNull();
    // Core copy still holds.
    expect(screen.getByText(/We checked 30 entries across the current scope/)).toBeInTheDocument();
  });

  it("renders the 'switch to All events' suggestion under operational scope (default)", () => {
    render(<EmptyState variant="filtered" scannedCount={30} scope="operational" />);
    expect(screen.getByText("All events")).toBeInTheDocument();
    expect(screen.getByText(/non-operational types/)).toBeInTheDocument();
  });
});
