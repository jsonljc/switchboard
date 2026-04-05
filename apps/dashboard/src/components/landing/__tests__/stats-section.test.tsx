import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsSection } from "../stats-section";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
  );
});

describe("StatsSection", () => {
  it("renders section header", () => {
    render(<StatsSection />);
    expect(screen.getByText(/how switchboard agents work/i)).toBeInTheDocument();
  });

  it("renders all three stat labels", () => {
    render(<StatsSection />);
    expect(screen.getByText(/response time/i)).toBeInTheDocument();
    expect(screen.getByText(/follow-through/i)).toBeInTheDocument();
    expect(screen.getByText(/trust levels/i)).toBeInTheDocument();
  });

  it("renders the body copy", () => {
    render(<StatsSection />);
    expect(screen.getByText(/operational guarantees/i)).toBeInTheDocument();
  });
});
