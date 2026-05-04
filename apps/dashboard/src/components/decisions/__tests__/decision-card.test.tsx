import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionCard } from "../decision-card";
import type { DecisionCardComponentProps } from "../decision-card";

function makeProps(
  overrides: Partial<DecisionCardComponentProps> = {},
): DecisionCardComponentProps {
  return {
    folio: { kindLabel: "DECISION 1", rightFolio: "MAYA R. — 2D AGO" },
    serifSentence: "Should I send Maya the membership comparison?",
    primaryLabel: "Yes, send it",
    secondaryLabel: "Not yet",
    dismissLabel: "Dismiss",
    threadHref: "/contacts/maya/conversations",
    source: { kind: "approval", sourceId: "rec-1" },
    ...overrides,
  };
}

describe("DecisionCard", () => {
  it("renders the folio kindLabel", () => {
    render(<DecisionCard {...makeProps()} />);
    expect(screen.getByText("DECISION 1")).toBeInTheDocument();
  });

  it("renders the serif sentence", () => {
    render(<DecisionCard {...makeProps()} />);
    expect(screen.getByText("Should I send Maya the membership comparison?")).toBeInTheDocument();
  });

  it("renders only two pill buttons (primary + secondary) — dismiss is not in the design", () => {
    render(<DecisionCard {...makeProps()} />);
    expect(screen.getByRole("button", { name: "Yes, send it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeInTheDocument();
    // Dismiss action lives in the dispatcher contract; the design bundle
    // renders only 2 pills. Slice B2 will surface dismiss as a non-pill
    // affordance (icon menu / swipe / etc.).
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("fires onPrimary when the primary button is clicked", () => {
    const onPrimary = vi.fn();
    render(<DecisionCard {...makeProps({ onPrimary })} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("fires onSecondary when the secondary button is clicked", () => {
    const onSecondary = vi.fn();
    render(<DecisionCard {...makeProps({ onSecondary })} />);
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("renders threadHref as an anchor when present", () => {
    render(<DecisionCard {...makeProps()} />);
    const link = screen.getByRole("link", { name: /View thread/i });
    expect(link).toHaveAttribute("href", "/contacts/maya/conversations");
  });

  it("omits the thread link when threadHref is null", () => {
    render(<DecisionCard {...makeProps({ threadHref: null })} />);
    expect(screen.queryByRole("link", { name: /View thread/i })).not.toBeInTheDocument();
  });

  it("renders a Why button when `why` prop is provided", () => {
    render(<DecisionCard {...makeProps({ why: "Maya opened the pricing page three times." })} />);
    expect(screen.getByRole("button", { name: /Why this decision/i })).toBeInTheDocument();
    expect(screen.getByText("Maya opened the pricing page three times.")).toBeInTheDocument();
  });

  it("omits the Why button when `why` is absent", () => {
    render(<DecisionCard {...makeProps()} />);
    expect(screen.queryByRole("button", { name: /Why this decision/i })).not.toBeInTheDocument();
  });
});
