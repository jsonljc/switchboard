import { describe, it, expect } from "vitest";
import { compareSources } from "./source-comparator.js";

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
