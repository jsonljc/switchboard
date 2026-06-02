import { describe, it, expect } from "vitest";
import { compareSources, compareCampaigns, trueRoasFromCents } from "./source-comparator.js";

describe("compareSources", () => {
  it("computes per-source CPL, cost-per-booked, close rate, true ROAS", () => {
    const result = compareSources({
      bySource: {
        ctwa: { received: 100, qualified: 30, booked: 12, showed: 10, paid: 8, revenue: 800 },
        instant_form: {
          received: 200,
          qualified: 16,
          booked: 4,
          showed: 3,
          paid: 1,
          revenue: 80,
        },
      },
      spendBySource: { ctwa: 410, instant_form: 380 },
    });
    expect(result.rows).toHaveLength(2);
    const ctwa = result.rows.find((r) => r.source === "ctwa")!;
    expect(ctwa.cpl).toBeCloseTo(4.1, 2);
    expect(ctwa.costPerBooked).toBeCloseTo(34.17, 2);
    expect(ctwa.closeRate).toBeCloseTo(0.08, 2);
    expect(ctwa.trueRoas).toBeCloseTo(1.95, 2);
  });

  it("flags zero-spend sources without dividing by zero", () => {
    const result = compareSources({
      bySource: {
        ctwa: { received: 10, qualified: 0, booked: 0, showed: 0, paid: 0, revenue: 0 },
        instant_form: { received: 0, qualified: 0, booked: 0, showed: 0, paid: 0, revenue: 0 },
      },
      spendBySource: { ctwa: 100, instant_form: 0 },
    });
    expect(result.rows.find((r) => r.source === "instant_form")?.cpl).toBeNull();
  });
});

describe("trueRoasFromCents", () => {
  it("normalizes cents→dollars exactly once (the #819 cents trap)", () => {
    // 12345 cents = $123.45; ÷ $100 spend = 1.2345 — NOT 123.45
    expect(trueRoasFromCents(12345, 100)).toBeCloseTo(1.2345, 4);
  });
  it("returns null for unknown value or non-positive spend (never a fabricated 0)", () => {
    expect(trueRoasFromCents(null, 100)).toBeNull();
    expect(trueRoasFromCents(5000, 0)).toBeNull();
  });
});

describe("compareCampaigns", () => {
  const byCampaign = {
    c1: { received: 100, qualified: 30, booked: 10, showed: 0, paid: 2, revenue: 5000 },
    c2: { received: 40, qualified: 8, booked: 0, showed: 0, paid: 0, revenue: 0 },
  };

  it("booked-CAC from CRM booked count; trueROAS from booked value cents (normalized)", () => {
    const { rows } = compareCampaigns({
      byCampaign,
      spendByCampaign: { c1: 500, c2: 200 },
      bookedValueCentsByCampaign: new Map([["c1", 123450]]), // $1234.50
    });
    const c1 = rows.find((r) => r.campaignId === "c1")!;
    expect(c1.costPerBooked).toBeCloseTo(50, 2); // $500 / 10 booked
    expect(c1.bookedValueCents).toBe(123450);
    expect(c1.trueRoas).toBeCloseTo(2.469, 3); // $1234.50 / $500
  });

  it("honest null: bookings but no booked value → trueRoas null, costPerBooked present", () => {
    const { rows } = compareCampaigns({
      byCampaign,
      spendByCampaign: { c1: 500 },
      bookedValueCentsByCampaign: new Map(), // c1 absent
    });
    const c1 = rows.find((r) => r.campaignId === "c1")!;
    expect(c1.bookedValueCents).toBeNull();
    expect(c1.trueRoas).toBeNull();
    expect(c1.costPerBooked).toBeCloseTo(50, 2);
  });

  it("costPerBooked null when zero bookings", () => {
    const { rows } = compareCampaigns({
      byCampaign,
      spendByCampaign: { c2: 200 },
      bookedValueCentsByCampaign: new Map(),
    });
    expect(rows.find((r) => r.campaignId === "c2")!.costPerBooked).toBeNull();
  });

  it("preserves sparse campaign rows and drops value-only orphans", () => {
    const { rows } = compareCampaigns({
      byCampaign, // c1, c2
      spendByCampaign: { c1: 500 },
      bookedValueCentsByCampaign: new Map([
        ["c1", 1000],
        ["c_orphan", 9999], // absent from byCampaign → dropped
      ]),
    });
    expect(rows.map((r) => r.campaignId).sort()).toEqual(["c1", "c2"]);
  });
});
