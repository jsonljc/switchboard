// ---------------------------------------------------------------------------
// Signal Health Scorer — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { scoreSignalHealth } from "../signal-health.js";
import type { NormalizedData } from "@switchboard/schemas";

function makeData(overrides: Partial<NormalizedData> = {}): NormalizedData {
  return {
    accountId: "acc_1",
    organizationId: "org_1",
    collectedAt: new Date().toISOString(),
    dataTier: "PARTIAL",
    adMetrics: null,
    funnelEvents: [],
    creativeAssets: null,
    crmSummary: null,
    signalHealth: null,
    ...overrides,
  };
}

describe("scoreSignalHealth", () => {
  it("returns score 0 with LOW confidence when no signal data", () => {
    const result = scoreSignalHealth(makeData());
    expect(result.scorerName).toBe("signal-health");
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("LOW");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe("NO_SIGNAL_DATA");
  });

  it("returns high score for healthy signal data", () => {
    const result = scoreSignalHealth(
      makeData({
        dataTier: "FULL",
        signalHealth: {
          pixelActive: true,
          capiConfigured: true,
          eventMatchQuality: 9,
          eventCompleteness: 0.95,
          deduplicationRate: 0.05,
          conversionLagHours: 2,
        },
        crmSummary: {
          totalLeads: 100,
          matchedLeads: 80,
          matchRate: 0.8,
          openDeals: 10,
          averageDealValue: 500,
          averageTimeToFirstContact: 1,
          leadToCloseRate: 0.2,
        },
      }),
    );

    expect(result.score).toBeGreaterThan(80);
    expect(result.confidence).toBe("HIGH");
    expect(result.issues).toHaveLength(0);
  });

  it("flags critical issues for broken tracking", () => {
    const result = scoreSignalHealth(
      makeData({
        signalHealth: {
          pixelActive: false,
          capiConfigured: false,
          eventMatchQuality: 2,
          eventCompleteness: 0.1,
          deduplicationRate: null,
          conversionLagHours: 72,
        },
      }),
    );

    expect(result.score).toBeLessThan(30);
    const criticalCodes = result.issues.filter((i) => i.severity === "critical").map((i) => i.code);
    expect(criticalCodes).toContain("EVENT_COMPLETENESS_CRITICAL");
    expect(criticalCodes).toContain("NO_TRACKING");
    expect(criticalCodes).toContain("EMQ_CRITICAL");
    expect(criticalCodes).toContain("CONVERSION_LAG_CRITICAL");
  });

  it("flags warning when only pixel is active (no CAPI)", () => {
    const result = scoreSignalHealth(
      makeData({
        signalHealth: {
          pixelActive: true,
          capiConfigured: false,
          eventMatchQuality: null,
          eventCompleteness: 0.8,
          deduplicationRate: null,
          conversionLagHours: null,
        },
      }),
    );

    const warningCodes = result.issues.filter((i) => i.severity === "warning").map((i) => i.code);
    expect(warningCodes).toContain("PARTIAL_TRACKING");
  });

  it("flags CRM match rate issues", () => {
    const result = scoreSignalHealth(
      makeData({
        signalHealth: {
          pixelActive: true,
          capiConfigured: true,
          eventMatchQuality: 7,
          eventCompleteness: 0.85,
          deduplicationRate: 0.1,
          conversionLagHours: 6,
        },
        crmSummary: {
          totalLeads: 100,
          matchedLeads: 10,
          matchRate: 0.1,
          openDeals: 5,
          averageDealValue: 300,
          averageTimeToFirstContact: 8,
          leadToCloseRate: 0.05,
        },
      }),
    );

    const criticalCodes = result.issues.filter((i) => i.severity === "critical").map((i) => i.code);
    expect(criticalCodes).toContain("CRM_MATCH_CRITICAL");
  });

  it("provides score breakdown", () => {
    const result = scoreSignalHealth(
      makeData({
        signalHealth: {
          pixelActive: true,
          capiConfigured: true,
          eventMatchQuality: 7,
          eventCompleteness: 0.85,
          deduplicationRate: 0.1,
          conversionLagHours: 6,
        },
      }),
    );

    expect(result.breakdown).toBeDefined();
    expect(result.breakdown!["eventCompleteness"]).toBe(85);
    expect(result.breakdown!["trackingCoverage"]).toBeDefined();
    expect(result.breakdown!["crmMatch"]).toBeDefined();
    expect(result.breakdown!["conversionLag"]).toBeDefined();
  });

  it("clamps score to 0-100 range", () => {
    const result = scoreSignalHealth(
      makeData({
        signalHealth: {
          pixelActive: true,
          capiConfigured: true,
          eventMatchQuality: 10,
          eventCompleteness: 1.0,
          deduplicationRate: 0.0,
          conversionLagHours: 0,
        },
        crmSummary: {
          totalLeads: 100,
          matchedLeads: 100,
          matchRate: 1.0,
          openDeals: 10,
          averageDealValue: 500,
          averageTimeToFirstContact: 1,
          leadToCloseRate: 0.5,
        },
      }),
    );

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
