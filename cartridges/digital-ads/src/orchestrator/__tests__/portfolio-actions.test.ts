import { describe, it, expect } from "vitest";
import { generatePortfolioActions } from "../portfolio-actions.js";
import type { PlatformResult, CrossPlatformFinding, BudgetRecommendation } from "../types.js";
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
    spend: { current: 1000, previous: 1200 },
    primaryKPI: {
      name: "purchase",
      current: 25,
      previous: 20,
      deltaPercent: 25,
      severity: "warning",
    },
    stageAnalysis: [
      {
        stageName: "awareness",
        metric: "impressions",
        currentValue: 10000,
        previousValue: 12000,
        delta: -2000,
        deltaPercent: -16.7,
        isSignificant: true,
        severity: "warning",
      },
      {
        stageName: "purchase",
        metric: "purchase",
        currentValue: 40,
        previousValue: 60,
        delta: -20,
        deltaPercent: -33.3,
        isSignificant: true,
        severity: "critical",
      },
    ],
    dropoffs: [],
    bottleneck: null,
    findings: [
      { severity: "critical", stage: "purchase", message: "Test", recommendation: null },
    ],
    ...overrides,
  };
}

function makePlatformResult(
  platform: "meta" | "google" | "tiktok",
  result?: DiagnosticResult
): PlatformResult {
  return {
    platform,
    status: "success",
    result: result ?? makeDiagnosticResult({ platform }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generatePortfolioActions", () => {
  it("returns empty array when no actionable data", () => {
    const actions = generatePortfolioActions([], [], []);
    expect(actions).toHaveLength(0);
  });

  it("generates actions from platform elasticity data", () => {
    const result = makeDiagnosticResult({
      platform: "meta",
      elasticity: {
        totalEstimatedRevenueLoss: -2000,
        impactRanking: [
          { stage: "purchase", estimatedRevenueDelta: -2000, severity: "critical" },
        ],
      },
    });

    const actions = generatePortfolioActions(
      [makePlatformResult("meta", result)],
      [],
      []
    );

    expect(actions.length).toBeGreaterThanOrEqual(1);
    const bottleneckAction = actions.find((a) => a.action.includes("bottleneck"));
    expect(bottleneckAction).toBeDefined();
    expect(bottleneckAction!.estimatedRevenueRecovery).toBe(2000);
    expect(bottleneckAction!.priority).toBe(1);
    expect(bottleneckAction!.riskLevel).toBe("low");
  });

  it("generates actions from budget recommendations", () => {
    const budgetRecs: BudgetRecommendation[] = [
      {
        from: "meta",
        to: "google",
        reason: "Meta CPA worsened, Google improved",
        confidence: "high",
        suggestedShiftPercent: 15,
        estimatedKPIImprovement: 10,
        riskLevel: "medium",
      },
    ];

    const actions = generatePortfolioActions(
      [makePlatformResult("meta"), makePlatformResult("google")],
      [],
      budgetRecs
    );

    const shiftAction = actions.find((a) => a.action.includes("Shift"));
    expect(shiftAction).toBeDefined();
    expect(shiftAction!.requiredBudgetShiftPercent).toBe(15);
    expect(shiftAction!.confidenceScore).toBe(0.85); // high confidence
  });

  it("generates actions from cross-platform findings", () => {
    const findings: CrossPlatformFinding[] = [
      {
        signal: "market_wide_cpm_increase",
        severity: "warning",
        platforms: ["meta", "google"],
        message: "CPMs up everywhere",
        recommendation: "Reduce spend",
        confidenceScore: 0.7,
      },
    ];

    const actions = generatePortfolioActions(
      [makePlatformResult("meta"), makePlatformResult("google")],
      findings,
      []
    );

    const marketAction = actions.find((a) => a.action.includes("Market-wide"));
    expect(marketAction).toBeDefined();
    expect(marketAction!.riskLevel).toBe("medium");
  });

  it("sorts actions by revenue recovery (highest first)", () => {
    const metaResult = makeDiagnosticResult({
      platform: "meta",
      elasticity: {
        totalEstimatedRevenueLoss: -5000,
        impactRanking: [
          { stage: "purchase", estimatedRevenueDelta: -5000, severity: "critical" },
        ],
      },
    });

    const googleResult = makeDiagnosticResult({
      platform: "google",
      elasticity: {
        totalEstimatedRevenueLoss: -1000,
        impactRanking: [
          { stage: "purchase", estimatedRevenueDelta: -1000, severity: "warning" },
        ],
      },
    });

    const actions = generatePortfolioActions(
      [makePlatformResult("meta", metaResult), makePlatformResult("google", googleResult)],
      [],
      []
    );

    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions[0].estimatedRevenueRecovery).toBeGreaterThan(
      actions[1].estimatedRevenueRecovery
    );
    expect(actions[0].priority).toBe(1);
    expect(actions[1].priority).toBe(2);
  });

  it("assigns correct risk levels based on budget shift", () => {
    const budgetRecs: BudgetRecommendation[] = [
      {
        from: "meta",
        to: "google",
        reason: "test",
        confidence: "medium",
        suggestedShiftPercent: 5, // low risk
      },
      {
        from: "google",
        to: "tiktok",
        reason: "test",
        confidence: "medium",
        suggestedShiftPercent: 35, // high risk
      },
    ];

    const actions = generatePortfolioActions(
      [makePlatformResult("meta"), makePlatformResult("google"), makePlatformResult("tiktok")],
      [],
      budgetRecs
    );

    const lowRisk = actions.find((a) => a.action.includes("5%"));
    const highRisk = actions.find((a) => a.action.includes("35%"));
    expect(lowRisk?.riskLevel).toBe("low");
    expect(highRisk?.riskLevel).toBe("high");
  });

  it("skips elasticity actions with trivial revenue impact", () => {
    const result = makeDiagnosticResult({
      platform: "meta",
      elasticity: {
        totalEstimatedRevenueLoss: -5,
        impactRanking: [
          { stage: "purchase", estimatedRevenueDelta: -5, severity: "info" },
        ],
      },
    });

    const actions = generatePortfolioActions(
      [makePlatformResult("meta", result)],
      [],
      []
    );

    // Should skip because revenue loss < $10
    const bottleneckAction = actions.find((a) => a.action.includes("bottleneck"));
    expect(bottleneckAction).toBeUndefined();
  });
});
