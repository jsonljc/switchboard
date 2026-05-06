import { describe, it, expect } from "vitest";
import { computeCostVsValue, SDR_MONTHLY_USD, AGENCY_MONTHLY_USD } from "./cost-vs-value-rule.js";
import type { RollupContext } from "./types.js";

function makeCtx(startISO: string, endISO: string): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date(startISO),
      end: new Date(endISO),
      window: "THIS MONTH",
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

describe("computeCostVsValue", () => {
  it("prorates monthly plan to a 30-day window", async () => {
    const ctx = makeCtx("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z");
    const result = await computeCostVsValue(ctx, 299);

    expect(result.cost.paid).toBeCloseTo(299, 0);
    expect(result.cost.alt).toBeCloseTo(SDR_MONTHLY_USD + AGENCY_MONTHLY_USD, 0);
    expect(result.cost.saving).toBeCloseTo(result.cost.alt - result.cost.paid, 0);
  });

  it("prorates to a 7-day window", async () => {
    const ctx = makeCtx("2026-04-07T00:00:00Z", "2026-04-14T00:00:00Z");
    const result = await computeCostVsValue(ctx, 499);

    const days = 7;
    expect(result.cost.paid).toBeCloseTo(499 * (days / 30), 0);
    expect(result.cost.alt).toBeCloseTo((SDR_MONTHLY_USD + AGENCY_MONTHLY_USD) * (days / 30), 0);
  });

  it("returns zero paid when planMonthlyUSD is 0", async () => {
    const ctx = makeCtx("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z");
    const result = await computeCostVsValue(ctx, 0);

    expect(result.cost.paid).toBe(0);
    expect(result.cost.saving).toBe(result.cost.alt);
    expect(result.costNarrative).toContain("No active subscription");
  });

  it("narrative mentions estimate disclaimer", async () => {
    const ctx = makeCtx("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z");
    const result = await computeCostVsValue(ctx, 299);

    expect(result.costNarrative).toContain("estimated");
  });
});
