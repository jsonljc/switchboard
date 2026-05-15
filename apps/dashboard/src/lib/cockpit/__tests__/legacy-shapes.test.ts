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

  it("cpb null when booked === 0", () => {
    const roi = legacyRoi({ ...base, booked: 0, spend: 100, avgValue: 179, target: 30 });
    if ("degraded" in roi!) throw new Error("expected full ROI");
    expect(roi.comparator.value).toBe("—");
  });

  it("degraded when avgValue is null — 'Set average booking value' hint", () => {
    const roi = legacyRoi({ ...base, avgValue: null });
    expect(roi).toMatchObject({
      degraded: true,
      degradedHint: "Set average booking value to see return on spend",
    });
  });

  it("degraded when spend is null — 'Connect Meta Ads' hint", () => {
    const roi = legacyRoi({ ...base, spend: null });
    expect(roi).toMatchObject({
      degraded: true,
      degradedHint: "Connect Meta Ads to see return on spend",
    });
  });

  it("degraded when both null — prefers Meta Ads hint", () => {
    const roi = legacyRoi({ ...base, spend: null, avgValue: null });
    expect(roi).toMatchObject({
      degraded: true,
      degradedHint: "Connect Meta Ads to see return on spend",
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
