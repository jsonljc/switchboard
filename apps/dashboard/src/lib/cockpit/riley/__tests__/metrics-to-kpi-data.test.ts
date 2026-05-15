import { describe, expect, it } from "vitest";
import { metricsViewModelToRileyKpiData } from "../metrics-to-kpi-data";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";

// Riley adapter is strict — no legacy-shape fallback. If tiles or roi are
// missing on the wire, the adapter returns null and the page renders no KPI
// strip. This guards against Alex's `qualified` tile leaking into /riley via
// `legacyTiles()` derivation.

const baseWire: MetricsViewModelWire = {
  hero: { kind: "ad-leads", value: 27, comparator: { window: "week", value: 22 } },
  heroSubProseSegments: [{ kind: "text", text: "+5 from last week." }],
  spark: [],
  stats: [
    { label: "Leads", display: "27", rawValue: 27, unit: "count" },
    { label: "CTR", display: "—", rawValue: null, unit: "percent", unavailable: true },
    { label: "Spend", display: "$200", rawValue: 20000, unit: "currency", unavailable: false },
  ],
  freshness: {
    generatedAt: "2026-05-06T07:30:00.000Z",
    window: "week",
    dataSource: "live",
  },
  folioRange: "Mon — Wed",
  targets: { avgValueCents: null, targetCpbCents: 500 },
  spendCents: 20000,
  leads: 27,
  qualifiedPct: 0,
  bookedDelta: "+5",
  leadsDelta: "+5",
  qualifiedDelta: null,
  tiles: [
    { label: "leads", value: 27, trend: "+5" },
    { label: "ctr", value: "—", unavailable: true },
    { label: "ad spend", value: "$200" },
  ],
  roi: {
    degraded: true,
    degradedHint: "",
    label: "cost per lead",
    comparator: { value: "$7 per lead", target: "target $5" },
  },
};

describe("metricsViewModelToRileyKpiData", () => {
  it("passes tiles through unchanged (typed pass-through)", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out).not.toBeNull();
    expect(out!.tiles).toEqual(baseWire.tiles);
  });

  it("passes roi through unchanged", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out).not.toBeNull();
    expect(out!.roi).toEqual(baseWire.roi);
  });

  it("formats range as 'This week · {folioRange}'", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out!.range).toBe("This week · Mon — Wed");
  });

  it("does not surface qualifiedPct as a tile (Riley has no qualified concept)", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect((out!.tiles ?? []).map((t) => t.label)).not.toContain("qualified");
  });

  it("does not populate the Alex-flat fields (booked/leads/avgValue/target)", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out!.booked).toBeUndefined();
    expect(out!.avgValue).toBeUndefined();
    expect(out!.target).toBeUndefined();
  });

  it("returns null when vm.tiles is missing (no legacy-shape fallback)", () => {
    const { tiles: _omit, ...wireWithoutTiles } = baseWire;
    const out = metricsViewModelToRileyKpiData(wireWithoutTiles as MetricsViewModelWire);
    expect(out).toBeNull();
  });

  it("returns null when vm.roi is missing (no legacy-shape fallback)", () => {
    const { roi: _omit, ...wireWithoutRoi } = baseWire;
    const out = metricsViewModelToRileyKpiData(wireWithoutRoi as MetricsViewModelWire);
    expect(out).toBeNull();
  });
});
