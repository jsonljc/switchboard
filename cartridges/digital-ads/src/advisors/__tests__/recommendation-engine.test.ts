// ---------------------------------------------------------------------------
// Tests — Recommendation Engine
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { generateRecommendations } from "../recommendation-engine.js";
import type { DiagnosticResult, Finding } from "../../core/types.js";

function makeDiagnostic(
  findings: Finding[],
  overrides?: Partial<DiagnosticResult>,
): DiagnosticResult {
  return {
    vertical: "commerce",
    entityId: "act_123",
    platform: "meta",
    periods: {
      current: { since: "2026-02-28", until: "2026-03-07" },
      previous: { since: "2026-02-21", until: "2026-02-28" },
    },
    spend: { current: 1000, previous: 1200 },
    primaryKPI: {
      name: "ROAS",
      current: 3.5,
      previous: 4.2,
      deltaPercent: -16.7,
      severity: "warning",
    },
    stageAnalysis: [],
    dropoffs: [],
    bottleneck: null,
    findings,
    ...overrides,
  };
}

describe("generateRecommendations", () => {
  it("returns empty proposals for healthy findings only", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "healthy",
          stage: "Impressions",
          message: "Looking good",
          recommendation: null,
        },
        { severity: "info", stage: "Clicks", message: "Slight increase", recommendation: null },
      ]),
    );

    expect(result.proposals).toHaveLength(0);
    expect(result.unactionable).toHaveLength(2);
    expect(result.summary.totalFindings).toBe(2);
    expect(result.summary.actionableCount).toBe(0);
  });

  it("generates proposal for creative fatigue finding", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "critical",
          stage: "CTR",
          message: "Creative fatigue detected: CTR dropped 35% while CPM remained stable",
          recommendation: "Refresh ad creatives",
        },
      ]),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.finding.severity).toBe("critical");
    expect(result.proposals[0]!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.proposals[0]!.rationale).toContain("Creative fatigue");
  });

  it("generates proposal for budget underspend finding", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "warning",
          stage: "Spend",
          message: "Budget pacing issue: account is not fully spending its daily budget",
          recommendation: "Check bid caps and targeting breadth",
        },
      ]),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.rationale).toContain("Budget pacing");
    expect(result.proposals[0]!.actionType).toBe("digital-ads.structure.analyze");
  });

  it("generates proposal for ad set fragmentation", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "warning",
          stage: "Structure",
          message: "Ad set fragmentation: 12 active ad sets splitting $50/day budget",
          recommendation: "Consolidate similar ad sets",
        },
      ]),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.rationale).toContain("fragmentation");
  });

  it("generates proposal for ROAS below target", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "critical",
          stage: "Conversions",
          message: "ROAS is below target: 2.1x vs 4.0x target return on ad spend",
          recommendation: "Review conversion funnel",
        },
      ]),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.funnel.diagnose");
  });

  it("generates proposal for audience saturation", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "warning",
          stage: "Reach",
          message: "Audience saturation: frequency is high at 4.2x in 7 days",
          recommendation: "Expand targeting",
        },
      ]),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.rationale).toContain("saturation");
  });

  it("generates proposal for bid strategy issues", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "warning",
          stage: "Delivery",
          message: "Bid strategy mismatch: lowest cost bid cap limiting delivery",
          recommendation: "Consider switching to cost cap",
        },
      ]),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.rationale).toContain("Bid strategy");
  });

  it("handles multiple findings and sorts by confidence", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "critical",
          stage: "CTR",
          message: "Creative fatigue detected: CTR dropped 40%",
          recommendation: null,
        },
        {
          severity: "warning",
          stage: "Structure",
          message: "Ad set fragmentation detected across 15 ad sets",
          recommendation: null,
        },
        { severity: "info", stage: "CPC", message: "CPC slightly up", recommendation: null },
      ]),
    );

    expect(result.proposals.length).toBeGreaterThanOrEqual(2);
    expect(result.summary.totalFindings).toBe(3);
    // Sorted by confidence descending
    for (let i = 1; i < result.proposals.length; i++) {
      expect(result.proposals[i - 1]!.confidence).toBeGreaterThanOrEqual(
        result.proposals[i]!.confidence,
      );
    }
  });

  it("deduplicates proposals with same action + parameters", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "critical",
          stage: "CTR",
          message: "Creative fatigue detected: CTR dropped",
          recommendation: null,
        },
        {
          severity: "warning",
          stage: "Engagement",
          message: "Creative exhaustion: engagement declining",
          recommendation: null,
        },
      ]),
    );

    // Both match creative fatigue pattern → same action → deduplicated
    const uniquePairs = new Set(
      result.proposals.map((p) => `${p.actionType}:${JSON.stringify(p.parameters)}`),
    );
    expect(uniquePairs.size).toBe(result.proposals.length);
  });

  it("marks unmatched high-severity findings as unactionable", () => {
    const result = generateRecommendations(
      makeDiagnostic([
        {
          severity: "warning",
          stage: "Custom",
          message: "Some unrecognized issue pattern",
          recommendation: "Do something",
        },
      ]),
    );

    expect(result.proposals).toHaveLength(0);
    expect(result.unactionable).toHaveLength(1);
    expect(result.unactionable[0]!.reason).toContain("No matching action pattern");
  });
});
