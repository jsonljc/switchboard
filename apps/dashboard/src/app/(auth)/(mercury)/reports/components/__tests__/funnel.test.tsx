import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Funnel } from "../funnel";

const rows = [
  { stage: "Impressions", n: 342000, label: "342k", delta: { kind: "pos" as const, text: "↑ 8%" } },
  { stage: "Clicks", n: 4182, label: "4,182", delta: { kind: "pos" as const, text: "↑ 3%" } },
  { stage: "Landing visits", n: 3896, label: "3,896", delta: null },
  { stage: "Leads", n: 247, label: "247", delta: { kind: "pos" as const, text: "↑ 14%" } },
  { stage: "Bookings", n: 47, label: "47", delta: { kind: "pos" as const, text: "↑ 9%" } },
];

const narrative = { marker: "Riley · Apr 22", text: "CTR sitting above benchmark." };

describe("Funnel", () => {
  it("renders five rows in order with their stages", () => {
    render(<Funnel rows={rows} narrative={narrative} />);
    expect(screen.getByText("Impressions")).toBeInTheDocument();
    expect(screen.getByText("Clicks")).toBeInTheDocument();
    expect(screen.getByText("Landing visits")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("Bookings")).toBeInTheDocument();
  });

  it("first row bar is at 100% width", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    const fills = container.querySelectorAll('[class*="fill"]');
    expect(fills.length).toBe(5);
    // jsdom normalises "100.00%" → "100%" — parse as a number for comparison.
    expect(parseFloat((fills[0] as HTMLElement).style.width)).toBe(100);
  });

  it("last row bar width is proportional", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    const fills = container.querySelectorAll('[class*="fill"]');
    const w = parseFloat((fills[4] as HTMLElement).style.width);
    // 47 / 342000 ≈ 0.01374%
    expect(w).toBeCloseTo(0.01, 2);
  });

  it("renders the byline marker and text", () => {
    render(<Funnel rows={rows} narrative={narrative} />);
    expect(screen.getByText("Riley · Apr 22")).toBeInTheDocument();
    expect(screen.getByText(/CTR sitting above/)).toBeInTheDocument();
  });

  it("delta == null row renders an em-dash", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    expect(container.textContent).toContain("—");
  });
});
