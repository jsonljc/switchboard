import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResultsHeader } from "./results-header";

const DEFAULT_PROPS = {
  window: "THIS MONTH" as const,
  onWindow: vi.fn(),
  dateFolio: "APR 1 — APR 30",
  cacheAgeMinutes: null,
  onRecompute: vi.fn(),
  isRecomputing: false,
  isLive: false,
};

describe("ResultsHeader", () => {
  it("renders all three period labels", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} />);
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByText("This month")).toBeInTheDocument();
    expect(screen.getByText("This quarter")).toBeInTheDocument();
  });

  it("marks the active window as selected", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} window="THIS MONTH" />);
    const activeBtn = screen.getByText("This month").closest("button");
    expect(activeBtn).toHaveAttribute("aria-current", "true");
  });

  it("does not mark the inactive windows as selected", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} window="THIS MONTH" />);
    const weekBtn = screen.getByText("This week").closest("button");
    const quarterBtn = screen.getByText("This quarter").closest("button");
    expect(weekBtn).not.toHaveAttribute("aria-current");
    expect(quarterBtn).not.toHaveAttribute("aria-current");
  });

  it("calls onWindow with correct value when clicking a period", async () => {
    const onWindow = vi.fn();
    render(<ResultsHeader {...DEFAULT_PROPS} onWindow={onWindow} />);
    await userEvent.click(screen.getByText("This week"));
    expect(onWindow).toHaveBeenCalledWith("THIS WEEK");
  });

  it("renders the dateFolio", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} dateFolio="APR 1 — APR 30" />);
    expect(screen.getByText("APR 1 — APR 30")).toBeInTheDocument();
  });

  it("shows 'Recompute' when cacheAgeMinutes is null", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} cacheAgeMinutes={null} />);
    expect(screen.getByRole("button", { name: /Recompute/i })).toBeInTheDocument();
  });

  it("shows updated age when cacheAgeMinutes is a positive number", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} cacheAgeMinutes={5} />);
    expect(screen.getByText(/updated 5m ago/i)).toBeInTheDocument();
  });

  it("shows 'updated just now' when cacheAgeMinutes is 0", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} cacheAgeMinutes={0} />);
    expect(screen.getByText(/updated just now/i)).toBeInTheDocument();
  });

  it("shows 'Recomputing…' while isRecomputing", () => {
    render(<ResultsHeader {...DEFAULT_PROPS} isRecomputing={true} />);
    expect(screen.getByText(/Recomputing/i)).toBeInTheDocument();
  });

  it("calls onRecompute when the recompute button is clicked", async () => {
    const onRecompute = vi.fn();
    render(<ResultsHeader {...DEFAULT_PROPS} onRecompute={onRecompute} cacheAgeMinutes={3} />);
    await userEvent.click(screen.getByRole("button", { name: /Recompute/i }));
    expect(onRecompute).toHaveBeenCalledOnce();
  });
});
