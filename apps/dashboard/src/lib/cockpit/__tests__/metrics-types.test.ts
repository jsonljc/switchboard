import { describe, expect, it } from "vitest";
import type { MetricsViewModelWire, KpiTileWire, RoiBarWire } from "../metrics-types";

describe("MetricsViewModelWire B.2b shape", () => {
  it("admits tiles + roi as optional fields", () => {
    const tile: KpiTileWire = { label: "leads", value: 27, trend: "+5" };
    const roi: RoiBarWire = {
      degraded: true,
      degradedHint: "",
      label: "cost per booked",
      comparator: { value: "$4 per booked", target: "target $5" },
    };
    const wire: Partial<MetricsViewModelWire> = {
      tiles: [tile],
      roi,
    };
    expect(wire.tiles).toHaveLength(1);
    expect(wire.roi).toEqual(roi);
  });
});
