import { describe, expect, it } from "vitest";
import type { MetricsViewModel, KpiTile, RoiBar } from "../metrics-types.js";

describe("MetricsViewModel B.2b tiles + roi optional shape", () => {
  it("admits a KpiTile array under optional tiles", () => {
    const tile: KpiTile = { label: "leads", value: 27, trend: "+5" };
    const tiles: readonly KpiTile[] = [tile];
    // Type-only assertion — if the field is missing, this won't compile.
    const partial: Partial<MetricsViewModel> = { tiles };
    expect(partial.tiles).toEqual(tiles);
  });

  it("admits a RoiBar (degraded) under optional roi", () => {
    const roi: RoiBar = {
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "$4 per lead", target: "target $5" },
    };
    const partial: Partial<MetricsViewModel> = { roi };
    expect(partial.roi).toEqual(roi);
  });

  it("admits a RoiBar (full) under optional roi", () => {
    const roi: RoiBar = {
      label: "return on spend",
      leftMeta: "$200 spent",
      rightMeta: { value: "$1,000", suffix: " in tour value" },
      fillPct: 50,
      breakEvenPct: 16,
      breakEvenLabel: "break-even",
      scaleLeft: "$0",
      scaleRight: "6× spend",
      comparator: { value: "$7 per booking", target: "target $10", onTarget: true },
    };
    const partial: Partial<MetricsViewModel> = { roi };
    expect(partial.roi).toEqual(roi);
  });
});
