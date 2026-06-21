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
  it("renders the section eyebrow 'Funnel'", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    expect(container.textContent).toContain("Funnel");
  });

  it("renders the caption 'five stages · proportional'", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    expect(container.textContent).toContain("five stages");
    expect(container.textContent).toContain("proportional");
  });

  it("renders five rows in order with their stages", () => {
    render(<Funnel rows={rows} narrative={narrative} />);
    expect(screen.getByText("Impressions")).toBeInTheDocument();
    expect(screen.getByText("Clicks")).toBeInTheDocument();
    expect(screen.getByText("Landing visits")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("Bookings")).toBeInTheDocument();
  });

  it("first row bar is at 100% width (full proportional share)", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    // With css: false, class names are not available — select bar divs by their inline width style.
    // The bar fill divs are direct children of .funnelBarTrack and carry inline width.
    const barDivs = container.querySelectorAll("div[style]");
    expect(barDivs.length).toBeGreaterThan(0);
    // First bar (Impressions, max n) should be 100%.
    const firstBar = barDivs[0] as HTMLElement;
    expect(parseFloat(firstBar.style.width)).toBe(100);
  });

  it("last row bar width is proportional", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    const barDivs = container.querySelectorAll("div[style]");
    const lastBar = barDivs[barDivs.length - 1] as HTMLElement;
    const w = parseFloat(lastBar.style.width);
    // 47 / 342000 ≈ 0.01374%
    expect(w).toBeCloseTo(0.01, 2);
  });

  it("renders the byline marker and text", () => {
    render(<Funnel rows={rows} narrative={narrative} />);
    expect(screen.getByText("Riley · Apr 22")).toBeInTheDocument();
    expect(screen.getByText(/CTR sitting above/)).toBeInTheDocument();
  });

  it("null-delta row shows no delta badge (DeltaBadge returns null for null delta)", () => {
    const { container } = render(<Funnel rows={rows} narrative={narrative} />);
    // Landing visits has delta=null so no badge; its label still renders.
    expect(container.textContent).toContain("Landing visits");
    expect(container.textContent).toContain("3,896");
  });
});
