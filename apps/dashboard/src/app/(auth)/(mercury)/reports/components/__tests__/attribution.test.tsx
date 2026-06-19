import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Attribution } from "../attribution";

const data = {
  total: 14720,
  delta: { kind: "pos" as const, text: "↑ 22% vs Mar" },
  riley: { value: 9180, caption: "ad-driven leads converted" },
  alex: { value: 5540, caption: "reply conversions" },
};

describe("Attribution", () => {
  it("renders the hero number as one clean S$ amount via fmtSGD", () => {
    const { container } = render(<Attribution data={data} />);
    expect(container.textContent).toContain("S$14,720");
  });

  it("renders 'Revenue we drove' eyebrow (not 'Attributed pipeline')", () => {
    render(<Attribution data={data} />);
    expect(screen.getByText(/Revenue we drove/i)).toBeInTheDocument();
    expect(screen.queryByText(/Attributed pipeline/i)).toBeNull();
  });

  it("renders Riley and Alex cards with their captions", () => {
    render(<Attribution data={data} />);
    expect(screen.getByText("Riley")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("ad-driven leads converted")).toBeInTheDocument();
    expect(screen.getByText("reply conversions")).toBeInTheDocument();
  });

  it("share bar widths sum to roughly 100%", () => {
    const { container } = render(<Attribution data={data} />);
    const bars = container.querySelectorAll('[class*="shareBar"] > span');
    expect(bars.length).toBe(2);
    const widths = Array.from(bars).map((b) => parseFloat((b as HTMLElement).style.width));
    const sum = (widths[0] ?? 0) + (widths[1] ?? 0);
    expect(sum).toBeGreaterThan(99.5);
    expect(sum).toBeLessThan(100.5);
  });

  it("renders the delta badge with positive arrow", () => {
    render(<Attribution data={data} />);
    expect(screen.getByText("↑")).toBeInTheDocument();
  });
});
