import { describe, expect, it } from "vitest";
import { HomeSummarySchema } from "../home-summary.js";

const ready = {
  attributedValueCents: {
    state: "ready",
    value: 480000,
    comparator: { window: "week", value: 300000 },
    freshness: { generatedAt: "2026-06-20T00:00:00.000Z", window: "week", dataSource: "live" },
  },
  bookings: {
    state: "ready",
    value: 5,
    comparator: { window: "week", value: 3 },
    freshness: { generatedAt: "2026-06-20T00:00:00.000Z", window: "week", dataSource: "live" },
  },
  currency: "SGD",
  generatedAt: "2026-06-20T00:00:00.000Z",
} as const;

describe("HomeSummarySchema", () => {
  it("parses a ready payload with cents money + comparator", () => {
    const parsed = HomeSummarySchema.safeParse(ready);
    expect(parsed.success).toBe(true);
  });

  it("parses empty + unavailable tile states", () => {
    expect(
      HomeSummarySchema.safeParse({
        ...ready,
        attributedValueCents: { state: "empty", reason: "no_current_week_bookings" },
        bookings: { state: "unavailable", reason: "store_unreachable" },
      }).success,
    ).toBe(true);
  });

  it("rejects a fractional (dollar-valued) cents field (cents-guard)", () => {
    expect(
      HomeSummarySchema.safeParse({
        ...ready,
        attributedValueCents: { ...ready.attributedValueCents, value: 4800.5 },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-SGD currency", () => {
    expect(HomeSummarySchema.safeParse({ ...ready, currency: "USD" }).success).toBe(false);
  });
});
