// packages/core/src/reports/period-helpers.test.ts
import { describe, expect, it } from "vitest";
import {
  windowToRange,
  priorPeriodRange,
  formatCurrencyUSD,
  formatCurrencySGD,
  formatDateFolio,
} from "./period-helpers.js";

describe("windowToRange", () => {
  it("THIS WEEK returns Mon 00:00 → next Mon 00:00 in UTC", () => {
    const wed = new Date("2026-04-29T15:00:00Z"); // Wednesday
    const r = windowToRange("THIS WEEK", wed);
    expect(r.start.toISOString()).toBe("2026-04-27T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-04T00:00:00.000Z");
    expect(r.window).toBe("THIS WEEK");
  });

  it("THIS MONTH returns 1st 00:00 → next month 1st 00:00", () => {
    const r = windowToRange("THIS MONTH", new Date("2026-04-15T12:00:00Z"));
    expect(r.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("THIS QUARTER returns first day of quarter → first day of next quarter", () => {
    const r = windowToRange("THIS QUARTER", new Date("2026-04-15T12:00:00Z"));
    expect(r.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("THIS QUARTER for January maps to Q1 (Jan-Apr)", () => {
    const r = windowToRange("THIS QUARTER", new Date("2026-01-20T00:00:00Z"));
    expect(r.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("priorPeriodRange", () => {
  it("for a 7-day THIS WEEK, returns the previous 7 days", () => {
    const current = windowToRange("THIS WEEK", new Date("2026-04-29T15:00:00Z"));
    const prior = priorPeriodRange(current);
    expect(prior.start.toISOString()).toBe("2026-04-20T00:00:00.000Z");
    expect(prior.end.toISOString()).toBe("2026-04-27T00:00:00.000Z");
    expect(prior.window).toBeNull();
  });

  it("for THIS MONTH, returns the previous calendar month", () => {
    const current = windowToRange("THIS MONTH", new Date("2026-04-15T00:00:00Z"));
    const prior = priorPeriodRange(current);
    expect(prior.start.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(prior.end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("for THIS QUARTER, returns the previous calendar quarter", () => {
    const current = windowToRange("THIS QUARTER", new Date("2026-04-15T00:00:00Z"));
    const prior = priorPeriodRange(current);
    expect(prior.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(prior.end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("formatCurrencyUSD", () => {
  it("formats whole dollars without decimals", () => {
    expect(formatCurrencyUSD(14700)).toBe("$14,700");
  });

  it("formats sub-dollar with cents when under 1000", () => {
    expect(formatCurrencyUSD(447.75)).toBe("$447.75");
  });

  it("formats zero as $0", () => {
    expect(formatCurrencyUSD(0)).toBe("$0");
  });

  it("formats negative numbers with a leading -", () => {
    expect(formatCurrencyUSD(-200)).toBe("-$200");
  });
});

describe("formatDateFolio", () => {
  it("formats a within-month range as 'APR 1 — APR 30'", () => {
    const r = {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window: "THIS MONTH" as const,
    };
    expect(formatDateFolio(r)).toBe("APR 1 — APR 30");
  });

  it("formats a quarter as 'FEB 1 — APR 30'", () => {
    const r = {
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window: "THIS QUARTER" as const,
    };
    expect(formatDateFolio(r)).toBe("FEB 1 — APR 30");
  });

  it("formats a week as 'APR 27 — MAY 3'", () => {
    const r = {
      start: new Date("2026-04-27T00:00:00Z"),
      end: new Date("2026-05-04T00:00:00Z"),
      window: "THIS WEEK" as const,
    };
    expect(formatDateFolio(r)).toBe("APR 27 — MAY 3");
  });
});

describe("formatCurrencySGD", () => {
  it("formats whole dollars without decimals when >= 1000", () => {
    expect(formatCurrencySGD(14700)).toBe("S$14,700");
  });
  it("formats sub-dollar with cents when under 1000 and fractional", () => {
    expect(formatCurrencySGD(447.75)).toBe("S$447.75");
  });
  it("formats integer under 1000 without cents", () => {
    expect(formatCurrencySGD(500)).toBe("S$500");
  });
  it("formats zero as S$0", () => {
    expect(formatCurrencySGD(0)).toBe("S$0");
  });
  it("formats negative numbers with a leading -", () => {
    expect(formatCurrencySGD(-200)).toBe("-S$200");
  });
  it("uses en-SG grouping for very large numbers", () => {
    expect(formatCurrencySGD(1234567)).toBe("S$1,234,567");
  });
});
