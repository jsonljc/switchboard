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
  folioRange: "Mon — Fri",
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

function makeVm(overrides: Partial<MetricsViewModel> = {}): MetricsViewModel {
  return {
    hero: { kind: "tours-booked", value: 14, comparator: { window: "week", value: 9 } },
    heroSubProseSegments: [{ kind: "text", text: "Up from 9 last week." }],
    spark: [
      { label: "Mon", value: 8 },
      { label: "Wed", value: 14, isProjection: true },
    ],
    stats: [
      { label: "Leads", display: "47", rawValue: 47, unit: "count" },
      { label: "Conversion", display: "26%", rawValue: 0.26, unit: "percent" },
      { label: "Spend", display: "—", rawValue: null, unit: "currency", unavailable: true },
    ],
    freshness: {
      generatedAt: "2026-05-06T07:30:00.000Z",
      window: "week",
      dataSource: "live",
      unavailableSources: ["ad-platform-spend"],
    },
    folioRange: "Mon — Wed",
    ...overrides,
  };
}

describe("MetricsBlock — PR-S5 UX", () => {
  it("renders vm.folioRange instead of hardcoded 'Mon — Fri'", () => {
    render(<MetricsBlock vm={makeVm({ folioRange: "Mon — Tue" })} agentKey="alex" />);
    expect(screen.getByText("Mon — Tue")).toBeInTheDocument();
    expect(screen.queryByText("Mon — Fri")).not.toBeInTheDocument();
  });

  it("renders '—' for unavailable cells (not their display fallback)", () => {
    render(<MetricsBlock vm={makeVm()} agentKey="alex" />);
    const spendCell = screen.getByText("Spend").closest(".stat-cell");
    expect(spendCell?.textContent).toContain("—");
  });

  it("renders '· no data: spend' chip when one source unavailable", () => {
    render(<MetricsBlock vm={makeVm()} agentKey="alex" />);
    expect(screen.getByText(/no data: spend/i)).toBeInTheDocument();
  });

  it("renders '· no data: CTR, spend' chip (alphabetized) when multiple", () => {
    const vm = makeVm({
      freshness: {
        generatedAt: "2026-05-06T07:30:00.000Z",
        window: "week",
        dataSource: "live",
        unavailableSources: ["ad-platform-spend", "ad-platform-ctr"],
      },
    });
    render(<MetricsBlock vm={vm} agentKey="riley" />);
    expect(screen.getByText(/no data: CTR, spend/i)).toBeInTheDocument();
  });

  it("renders '0' (not '—') for cells with rawValue=0 and no unavailable flag", () => {
    const vm = makeVm({
      stats: [
        { label: "Leads", display: "0", rawValue: 0, unit: "count" },
        { label: "Conversion", display: "0%", rawValue: 0, unit: "percent" },
        { label: "Spend", display: "—", rawValue: null, unit: "currency", unavailable: true },
      ],
    });
    render(<MetricsBlock vm={vm} agentKey="alex" />);
    const leadsCell = screen.getByText("Leads").closest(".stat-cell");
    expect(leadsCell?.textContent).toContain("0");
    expect(leadsCell?.textContent).not.toContain("—");
  });

  it("renders no chip when unavailableSources is empty/undefined", () => {
    const vm = makeVm({
      freshness: {
        generatedAt: "2026-05-06T07:30:00.000Z",
        window: "week",
        dataSource: "live",
      },
    });
    render(<MetricsBlock vm={vm} agentKey="alex" />);
    expect(screen.queryByText(/no data:/i)).not.toBeInTheDocument();
  });
});
