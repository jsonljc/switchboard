import { describe, expect, it } from "vitest";
import { metricsViewModelToLegacyKpiInput } from "../metrics-to-kpi-input";

const fullVm = {
  hero: { kind: "tours-booked", value: 9, comparator: { window: "week", value: 6 } },
  heroSubProseSegments: [],
  spark: [],
  stats: [
    { label: "Leads", display: "47", rawValue: 47, unit: "count" },
    { label: "Conversion", display: "19%", rawValue: 0.19, unit: "percent" },
    { label: "Spend", display: "$214", rawValue: 21400, unit: "currency", unavailable: false },
  ],
  freshness: { generatedAt: "2026-05-15T12:00:00Z", window: "week", dataSource: "live" },
  folioRange: "May 12 – May 18",
  targets: { avgValueCents: 17900, targetCpbCents: 3000 },
  spendCents: 21400,
  leads: 47,
  qualifiedPct: 19,
  bookedDelta: "+3",
  leadsDelta: "+12",
  qualifiedDelta: "+4 pts",
};

describe("metricsViewModelToLegacyKpiInput", () => {
  it("converts cents to dollars and propagates echoes", () => {
    const input = metricsViewModelToLegacyKpiInput(fullVm);
    expect(input.booked).toBe(9);
    expect(input.bookedDelta).toBe("+3");
    expect(input.leads).toBe(47);
    expect(input.leadsDelta).toBe("+12");
    expect(input.qualifiedPct).toBe(19);
    expect(input.qualifiedDelta).toBe("+4 pts");
    expect(input.spend).toBe(214);
    expect(input.avgValue).toBe(179);
    expect(input.target).toBe(30);
  });

  it("null spendCents → null spend", () => {
    const input = metricsViewModelToLegacyKpiInput({ ...fullVm, spendCents: null });
    expect(input.spend).toBeNull();
  });

  it("null targets → null avgValue and target", () => {
    const input = metricsViewModelToLegacyKpiInput({
      ...fullVm,
      targets: { avgValueCents: null, targetCpbCents: null },
    });
    expect(input.avgValue).toBeNull();
    expect(input.target).toBeNull();
  });
});
