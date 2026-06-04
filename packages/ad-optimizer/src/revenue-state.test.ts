import { describe, it, expect } from "vitest";
import {
  assembleRevenueState,
  withSpendAttributionCoverage,
  type RevenueState,
} from "./revenue-state.js";

describe("assembleRevenueState", () => {
  it("maps producer outputs onto typed fields and reserves businessContextFreshness", () => {
    const state = assembleRevenueState({
      measurementTrusted: true,
      economicTier: "cpl",
      effectiveTarget: 100,
      marginBasis: "unavailable",
      coverage: { coveragePct: 0.8, sufficient: true },
      signalHealthScore: "green",
    });
    expect(state).toEqual({
      measurementTrusted: true,
      economicTier: "cpl",
      effectiveTarget: 100,
      marginBasis: "unavailable",
      coverage: { coveragePct: 0.8, sufficient: true },
      signalHealthScore: "green",
      businessContextFreshness: "unknown",
    });
  });

  it("supports a partial (pre-economics) assembly with only required + early fields", () => {
    const state = assembleRevenueState({ measurementTrusted: false });
    expect(state.measurementTrusted).toBe(false);
    expect(state.economicTier).toBeUndefined();
    expect(state.spendAttributionCoverageBySource).toBeUndefined();
    expect(state.businessContextFreshness).toBe("unknown");
  });

  it("completes the late spend-attribution coverage field without mutating the input", () => {
    const base = assembleRevenueState({ measurementTrusted: true });
    const enriched = withSpendAttributionCoverage(base, { meta_ads: 0.9, google_ads: 0.4 });
    expect(enriched.spendAttributionCoverageBySource).toEqual({
      meta_ads: 0.9,
      google_ads: 0.4,
    });
    expect(base.spendAttributionCoverageBySource).toBeUndefined();
    expect(enriched.measurementTrusted).toBe(true);
    expect(enriched.businessContextFreshness).toBe("unknown");
  });

  it("is well-typed as RevenueState", () => {
    const state: RevenueState = assembleRevenueState({ measurementTrusted: true });
    expect(state.businessContextFreshness).toBe("unknown");
  });
});
