import { describe, expect, it } from "vitest";
import { attributeOneRecommendation } from "../outcome-attribution.js";
import type { AttributableRecommendation, WindowMetrics } from "../outcome-attribution-types.js";

/** Slice 4f: the executing work-unit id flows candidate -> outcome row. */

function w(spendCents: number): WindowMetrics {
  return { spendCents, ctr: 0.04, dailyRowCount: 7 };
}

const BASE: AttributableRecommendation = {
  id: "rec-1",
  organizationId: "org-1",
  campaignId: "camp-A",
  actionKind: "pause",
  resolvedAt: new Date("2026-05-01T12:00:00Z"),
  executableWorkUnitId: null,
};

describe("executableWorkUnitId passthrough", () => {
  it("a machine-acted candidate's work-unit id lands on the outcome row", () => {
    const row = attributeOneRecommendation({
      candidate: { ...BASE, executableWorkUnitId: "wu_99" },
      preWindow: w(50_000),
      postWindow: w(10_000),
      overlaps: [],
    });
    expect(row.executableWorkUnitId).toBe("wu_99");
    expect(row.recommendationId).toBe("rec-1");
  });

  it("an operator-acted candidate (null) stays null, byte-identical to today", () => {
    const row = attributeOneRecommendation({
      candidate: BASE,
      preWindow: w(50_000),
      postWindow: w(10_000),
      overlaps: [],
    });
    expect(row.executableWorkUnitId).toBeNull();
  });
});
