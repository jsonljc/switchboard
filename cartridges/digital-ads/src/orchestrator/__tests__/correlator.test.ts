import { describe, it, expect } from "vitest";
import { correlate } from "../correlator.js";
import type { PlatformResult } from "../types.js";
import type { DiagnosticResult } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDiagnosticResult(
  overrides: Partial<DiagnosticResult> = {}
): DiagnosticResult {
  return {
    vertical: "commerce",
    entityId: "act_123",
    periods: {
      current: { since: "2024-01-08", until: "2024-01-14" },
      previous: { since: "2024-01-01", until: "2024-01-07" },
    },
    spend: { current: 1000, previous: 1000 },
    primaryKPI: {
      name: "purchase",
      current: 50,
      previous: 50,
      deltaPercent: 0,
      severity: "healthy",
    },
    stageAnalysis: [
      {
        stageName: "awareness",
        metric: "impressions",
        currentValue: 10000,
        previousValue: 10000,
        delta: 0,
        deltaPercent: 0,
        isSignificant: false,
        severity: "healthy",
      },
    ],
    dropoffs: [],
    bottleneck: null,
    findings: [],
    ...overrides,
  };
}

function makePlatformResult(
  platform: "meta" | "google" | "tiktok",
  resultOverrides: Partial<DiagnosticResult> = {}
): PlatformResult {
  return {
    platform,
    status: "success",
    result: makeDiagnosticResult({ platform, ...resultOverrides }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("correlate", () => {
  it("returns empty results with fewer than 2 successful platforms", () => {
    const result = correlate([
      makePlatformResult("meta"),
    ]);

    expect(result.findings).toHaveLength(0);
    expect(result.budgetRecommendations).toHaveLength(0);
  });

  it("returns empty results when all platforms errored", () => {
    const result = correlate([
      { platform: "meta", status: "error", error: "fail" },
      { platform: "google", status: "error", error: "fail" },
    ]);

    expect(result.findings).toHaveLength(0);
    expect(result.budgetRecommendations).toHaveLength(0);
  });

  it("detects market-wide CPM increase when all platforms have CPM up", () => {
    // Both platforms: spend same, but impressions dropped → CPM up
    const result = correlate([
      makePlatformResult("meta", {
        spend: { current: 1000, previous: 1000 },
        stageAnalysis: [
          {
            stageName: "awareness",
            metric: "impressions",
            currentValue: 5000,  // was 10000 → CPM doubled
            previousValue: 10000,
            delta: -5000,
            deltaPercent: -50,
            isSignificant: true,
            severity: "critical",
          },
        ],
      }),
      makePlatformResult("google", {
        spend: { current: 2000, previous: 2000 },
        stageAnalysis: [
          {
            stageName: "awareness",
            metric: "impressions",
            currentValue: 8000,  // was 16000
            previousValue: 16000,
            delta: -8000,
            deltaPercent: -50,
            isSignificant: true,
            severity: "critical",
          },
        ],
      }),
    ]);

    const cpmFinding = result.findings.find(
      (f) => f.signal === "market_wide_cpm_increase"
    );
    expect(cpmFinding).toBeDefined();
    expect(cpmFinding!.severity).toBe("critical");
    expect(cpmFinding!.platforms).toContain("meta");
    expect(cpmFinding!.platforms).toContain("google");
    expect(cpmFinding!.confidenceScore).toBeGreaterThan(0);
  });

  it("does not flag market-wide CPM when only one platform is affected", () => {
    const result = correlate([
      makePlatformResult("meta", {
        spend: { current: 1000, previous: 1000 },
        stageAnalysis: [
          {
            stageName: "awareness",
            metric: "impressions",
            currentValue: 5000,
            previousValue: 10000,
            delta: -5000,
            deltaPercent: -50,
            isSignificant: true,
            severity: "critical",
          },
        ],
      }),
      makePlatformResult("google", {
        spend: { current: 1000, previous: 1000 },
        stageAnalysis: [
          {
            stageName: "awareness",
            metric: "impressions",
            currentValue: 10000, // no change
            previousValue: 10000,
            delta: 0,
            deltaPercent: 0,
            isSignificant: false,
            severity: "healthy",
          },
        ],
      }),
    ]);

    const cpmFinding = result.findings.find(
      (f) => f.signal === "market_wide_cpm_increase"
    );
    expect(cpmFinding).toBeUndefined();
  });

  it("detects halo effect when one platform's spend up and another's KPI improved", () => {
    const result = correlate([
      makePlatformResult("meta", {
        spend: { current: 1500, previous: 1000 }, // +50%
        primaryKPI: {
          name: "purchase",
          current: 50,
          previous: 50,
          deltaPercent: 0,
          severity: "healthy",
        },
      }),
      makePlatformResult("google", {
        spend: { current: 1000, previous: 1000 },
        primaryKPI: {
          name: "purchase",
          current: 35, // cost went down = improved
          previous: 50,
          deltaPercent: -30,
          severity: "healthy",
        },
      }),
    ]);

    const haloFinding = result.findings.find((f) => f.signal === "halo_effect");
    expect(haloFinding).toBeDefined();
    expect(haloFinding!.platforms).toContain("meta");
    expect(haloFinding!.platforms).toContain("google");
    expect(haloFinding!.riskLevel).toBe("low");
  });

  it("detects platform conflicts and generates budget recommendations", () => {
    const result = correlate([
      makePlatformResult("meta", {
        primaryKPI: {
          name: "purchase",
          current: 80,   // cost up 60% → worsening
          previous: 50,
          deltaPercent: 60,
          severity: "critical",
        },
      }),
      makePlatformResult("google", {
        primaryKPI: {
          name: "purchase",
          current: 30,   // cost down 40% → improving
          previous: 50,
          deltaPercent: -40,
          severity: "healthy",
        },
      }),
    ]);

    const conflictFinding = result.findings.find(
      (f) => f.signal === "platform_conflict"
    );
    expect(conflictFinding).toBeDefined();
    expect(conflictFinding!.severity).toBe("warning");

    // Should generate budget recommendation from meta → google
    expect(result.budgetRecommendations.length).toBeGreaterThanOrEqual(1);
    const rec = result.budgetRecommendations[0];
    expect(rec.from).toBe("meta");
    expect(rec.to).toBe("google");
    expect(rec.suggestedShiftPercent).toBeDefined();
    expect(rec.suggestedShiftPercent!).toBeGreaterThan(0);
    expect(rec.suggestedShiftPercent!).toBeLessThanOrEqual(30); // capped at 30
  });

  it("does not generate budget recommendations when no platform conflict", () => {
    const result = correlate([
      makePlatformResult("meta", {
        primaryKPI: {
          name: "purchase",
          current: 50,
          previous: 50,
          deltaPercent: 0,
          severity: "healthy",
        },
      }),
      makePlatformResult("google", {
        primaryKPI: {
          name: "purchase",
          current: 50,
          previous: 50,
          deltaPercent: 0,
          severity: "healthy",
        },
      }),
    ]);

    expect(result.budgetRecommendations).toHaveLength(0);
  });

  it("sets confidence scores on budget recommendations", () => {
    const result = correlate([
      makePlatformResult("meta", {
        primaryKPI: {
          name: "purchase",
          current: 90,
          previous: 50,
          deltaPercent: 80, // large worsening
          severity: "critical",
        },
      }),
      makePlatformResult("google", {
        primaryKPI: {
          name: "purchase",
          current: 25,
          previous: 50,
          deltaPercent: -50, // large improvement
          severity: "healthy",
        },
      }),
    ]);

    expect(result.budgetRecommendations.length).toBeGreaterThanOrEqual(1);
    const rec = result.budgetRecommendations[0];
    expect(rec.confidence).toBe("high"); // both deltas are large
    expect(rec.riskLevel).toBeDefined();
  });
});
