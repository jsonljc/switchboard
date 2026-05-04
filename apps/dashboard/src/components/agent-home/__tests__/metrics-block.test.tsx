import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricsBlock } from "../metrics-block";
import type { MetricsViewModel } from "@/lib/agent-home/types";

const vm: MetricsViewModel = {
  hero: { kind: "tours-booked", value: 14, comparator: { window: "week", value: 9 } },
  heroSubProseSegments: [{ kind: "text", text: "Up from 9 last week." }],
  spark: [
    { label: "Mon", value: 1 },
    { label: "Tue", value: 5 },
  ],
  stats: [
    { label: "Leads", display: "47", rawValue: 47, unit: "count" },
    { label: "Conversion", display: "26%", rawValue: 0.26, unit: "percent" },
    { label: "Spend", display: "$0", rawValue: 0, unit: "currency" },
  ],
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "week", dataSource: "fixture" },
};

describe("MetricsBlock", () => {
  it("renders hero number for tours-booked kind", () => {
    render(<MetricsBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("14 tours")).toBeInTheDocument();
  });

  it("renders all 3 stat cells", () => {
    render(<MetricsBlock vm={vm} agentKey="alex" />);
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("Conversion")).toBeInTheDocument();
    expect(screen.getByText("Spend")).toBeInTheDocument();
  });

  it("renders sparkline as aria-hidden SVG", () => {
    const { container } = render(<MetricsBlock vm={vm} agentKey="alex" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
