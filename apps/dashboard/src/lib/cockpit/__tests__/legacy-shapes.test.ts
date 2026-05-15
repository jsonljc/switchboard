import { describe, expect, it } from "vitest";
import { legacyTiles, legacyRoi, collapsedHeadline, type LegacyKpiInput } from "../legacy-shapes";

const base: LegacyKpiInput = {
  booked: 9,
  bookedDelta: "+3",
  leads: 47,
  leadsDelta: "+12",
  qualifiedPct: 28,
  qualifiedDelta: "+4 pts",
  spend: 214,
  avgValue: 179,
  target: 30,
};

describe("legacyTiles", () => {
  it("emits four tiles in the locked-design order", () => {
    const tiles = legacyTiles(base);
    expect(tiles.map((t) => t.label)).toEqual([
      "bookings",
      "leads worked",
      "qualified",
      "ad spend",
    ]);
    expect(tiles[0]).toMatchObject({ value: 9, trend: "+3" });
    expect(tiles[1]).toMatchObject({ value: 47, trend: "+12" });
    expect(tiles[2]).toMatchObject({ value: 28, unit: "%", trend: "+4 pts" });
    expect(tiles[3]).toMatchObject({ value: "$214" });
  });

  it("ad spend tile renders unavailable + Meta Ads hint when spend is null", () => {
    const tiles = legacyTiles({ ...base, spend: null });
    expect(tiles[3]).toMatchObject({
      label: "ad spend",
      unavailable: true,
      hint: "Connect Meta Ads",
    });
  });
});

describe("legacyRoi", () => {
  // Steady-state math (locked-design parity)
  it("steady-state on-target", () => {
    const roi = legacyRoi({ ...base, spend: 270, target: 30, booked: 9, avgValue: 179 });
    // cpb = 270/9 = 30 → onTarget
    if ("degraded" in roi!) throw new Error("expected full ROI");
    expect(roi.comparator.onTarget).toBe(true);
    expect(roi.comparator.value).toBe("$30 per booking");
    expect(roi.comparator.target).toBe("target $30");
  });

  it("fillPct caps at 100 when ratio > 6", () => {
    const roi = legacyRoi({ ...base, spend: 100, avgValue: 1000, booked: 9, target: 30 });
    if ("degraded" in roi!) throw new Error("expected full ROI");
    expect(roi.fillPct).toBe(100);
  });

  // Hint priority — five-row table-driven, in `legacy-shapes.ts` priority order.
  // Brief §ROI hint priority: first match wins.
  describe("hint priority (five-row table — first match wins)", () => {
    it("rule 1: spend null + avgValue null → Meta Ads hint", () => {
      const roi = legacyRoi({ ...base, spend: null, avgValue: null });
      expect(roi).toMatchObject({
        degraded: true,
        degradedHint: "Connect Meta Ads to see return on spend",
      });
    });

    it("rule 1 wins over rule 2: spend null + avgValue set → still Meta Ads hint", () => {
      const roi = legacyRoi({ ...base, spend: null, avgValue: 179 });
      expect(roi).toMatchObject({
        degraded: true,
        degradedHint: "Connect Meta Ads to see return on spend",
      });
    });

    it("rule 2: spend set + avgValue null → Set-avg-value hint", () => {
      const roi = legacyRoi({ ...base, spend: 214, avgValue: null });
      expect(roi).toMatchObject({
        degraded: true,
        degradedHint: "Set average booking value to see return on spend",
      });
    });

    it("rule 3: spend set + avgValue set + bookings === 0 → degraded with comparator '—' and no hint copy", () => {
      const roi = legacyRoi({ ...base, spend: 100, avgValue: 179, booked: 0, target: 30 });
      if (!("degraded" in roi)) throw new Error("expected degraded ROI");
      expect(roi.degraded).toBe(true);
      expect(roi.comparator.value).toBe("—");
      // Brief: "no hint copy — the degradation is 'no math possible,' not a missing setup step."
      expect(roi.degradedHint).toBe("");
    });

    it("rule 4: spend set + avgValue set + bookings > 0 → live", () => {
      const roi = legacyRoi({ ...base, spend: 270, avgValue: 179, booked: 9, target: 30 });
      expect("degraded" in roi).toBe(false);
    });
  });
});

describe("collapsedHeadline", () => {
  it("flat-shape headline uses bookings + cpb + bookedDelta", () => {
    const headline = collapsedHeadline({ ...base, range: "This week · May 12 – May 18" });
    if (headline.mode !== "flat") throw new Error("expected flat mode");
    expect(headline.bookedValue).toBe(9);
    expect(headline.cpb).toBe(Math.round(214 / 9));
    expect(headline.delta).toBe("+3");
  });

  it("explicit tiles[] headline uses first non-unavailable tile", () => {
    const headline = collapsedHeadline({
      ...base,
      range: "This week · May 12 – May 18",
      tiles: [
        { label: "ad spend", value: "—", unavailable: true },
        { label: "bookings", value: 12, trend: "+5" },
      ],
    });
    if (headline.mode !== "explicit") throw new Error("expected explicit mode");
    expect(headline.label).toBe("bookings");
    expect(headline.value).toBe(12);
    expect(headline.trend).toBe("+5");
  });
});
