import { describe, it, expect, vi } from "vitest";
import {
  assembleRevenueState,
  deriveBusinessContextFreshness,
  resolveBusinessContextFreshness,
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

describe("deriveBusinessContextFreshness (riley v3 slice 4c)", () => {
  const NOW = new Date("2026-06-05T09:00:00.000Z");

  it("returns unknown when no confirmation exists (honest absence, never fabricated)", () => {
    expect(deriveBusinessContextFreshness(null, NOW)).toBe("unknown");
  });

  it("returns fresh inside the vouch window", () => {
    const confirmedAt = new Date("2026-05-25T09:00:00.000Z"); // 11d old
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("fresh");
  });

  it("returns fresh at exactly the vouch boundary (a 14-day-old confirmation still vouches)", () => {
    const confirmedAt = new Date("2026-05-22T09:00:00.000Z"); // exactly 14d
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("fresh");
  });

  it("returns stale just past the vouch boundary", () => {
    const confirmedAt = new Date("2026-05-22T08:59:59.999Z"); // 14d + 1ms
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("stale");
  });

  it("treats a future-dated confirmedAt (clock skew) as fresh, never stale", () => {
    const confirmedAt = new Date("2026-06-05T10:00:00.000Z");
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("fresh");
  });
});

describe("resolveBusinessContextFreshness (provider wrapper)", () => {
  const NOW = new Date("2026-06-05T09:00:00.000Z");

  it("returns unknown when no provider is wired (eval harness / analysis-only callers)", async () => {
    expect(await resolveBusinessContextFreshness(undefined, "org-1", NOW)).toBe("unknown");
  });

  it("derives freshness from the provider's latest confirmation", async () => {
    const provider = {
      getLatest: vi.fn().mockResolvedValue({ confirmedAt: new Date("2026-06-01T00:00:00.000Z") }),
    };
    expect(await resolveBusinessContextFreshness(provider, "org-1", NOW)).toBe("fresh");
    expect(provider.getLatest).toHaveBeenCalledWith("org-1");
  });

  it("returns unknown for an org with no confirmations", async () => {
    const provider = { getLatest: vi.fn().mockResolvedValue(null) };
    expect(await resolveBusinessContextFreshness(provider, "org-1", NOW)).toBe("unknown");
  });

  it("degrades a read failure to unknown with a warning instead of sinking the weekly audit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = { getLatest: vi.fn().mockRejectedValue(new Error("db down")) };
    expect(await resolveBusinessContextFreshness(provider, "org-1", NOW)).toBe("unknown");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("assembleRevenueState: slice-4c freshness input", () => {
  it("passes an explicit freshness through", () => {
    const state = assembleRevenueState({
      measurementTrusted: true,
      businessContextFreshness: "fresh",
    });
    expect(state.businessContextFreshness).toBe("fresh");
  });

  it("defaults to unknown when absent (eval harness and analysis-only callers byte-unchanged)", () => {
    const state = assembleRevenueState({ measurementTrusted: true });
    expect(state.businessContextFreshness).toBe("unknown");
  });
});
