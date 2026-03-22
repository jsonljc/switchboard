import { describe, it, expect } from "vitest";
import { formatMultiPlatformDiagnostic } from "../multi-platform-diagnostic.js";
import type {
  MultiPlatformResult,
  PlatformResult,
  PortfolioAction,
} from "../../orchestrator/types.js";
import type { DiagnosticResult, Severity } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeDiagnosticResult(
  platform: string,
  overrides: Partial<DiagnosticResult> = {},
): DiagnosticResult {
  return {
    vertical: "commerce",
    entityId: "act_123",
    platform,
    periods: {
      current: { since: "2024-01-08", until: "2024-01-14" },
      previous: { since: "2024-01-01", until: "2024-01-07" },
    },
    spend: { current: 1000, previous: 950 },
    primaryKPI: {
      name: "purchase",
      current: 50,
      previous: 55,
      deltaPercent: -9.1,
      severity: "warning" as Severity,
    },
    stageAnalysis: [
      {
        stageName: "impressions",
        metric: "impressions",
        currentValue: 10000,
        previousValue: 9500,
        delta: 500,
        deltaPercent: 5.3,
        isSignificant: true,
        severity: "healthy" as Severity,
      },
    ],
    dropoffs: [],
    bottleneck: null,
    findings: [
      {
        severity: "warning" as Severity,
        stage: "purchase",
        message: "KPI declined",
        recommendation: "Review events",
      },
    ],
    ...overrides,
  };
}

function makeMultiPlatformResult(
  overrides: Partial<MultiPlatformResult> = {},
): MultiPlatformResult {
  return {
    platforms: [
      {
        platform: "meta",
        status: "success" as const,
        result: makeDiagnosticResult("meta"),
      },
      {
        platform: "google",
        status: "success" as const,
        result: makeDiagnosticResult("google"),
      },
    ],
    crossPlatformFindings: [],
    budgetRecommendations: [],
    executiveSummary: "Portfolio health is stable. Meta showing slight decline in conversions.",
    portfolioActions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("formatMultiPlatformDiagnostic", () => {
  it("includes executive summary at the top", () => {
    const result = makeMultiPlatformResult({
      executiveSummary: "All platforms performing well. No immediate action needed.",
    });

    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("All platforms performing well. No immediate action needed.");
    // Executive summary should be at the start
    const summaryIndex = output.indexOf("All platforms performing well");
    const platformIndex = output.indexOf("## Funnel Diagnostic");
    expect(summaryIndex).toBeLessThan(platformIndex);
  });

  it("formats per-platform results using formatDiagnostic", () => {
    const result = makeMultiPlatformResult();
    const output = formatMultiPlatformDiagnostic(result);

    // Should contain both platform headers
    expect(output).toContain("## Funnel Diagnostic: act_123 (META)");
    expect(output).toContain("## Funnel Diagnostic: act_123 (GOOGLE)");

    // Should contain diagnostic details
    expect(output).toContain("### Primary KPI: purchase");
    expect(output).toContain("Period: 2024-01-08 to 2024-01-14");
  });

  it("handles platform errors gracefully", () => {
    const result = makeMultiPlatformResult({
      platforms: [
        {
          platform: "meta",
          status: "success" as const,
          result: makeDiagnosticResult("meta"),
        },
        {
          platform: "tiktok",
          status: "error" as const,
          error: "Authentication failed: invalid access token",
        },
      ],
    });

    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("## TIKTOK — Error");
    expect(output).toContain("Authentication failed: invalid access token");
    // Should still show successful platform
    expect(output).toContain("## Funnel Diagnostic: act_123 (META)");
  });

  it("handles unknown error message", () => {
    const result = makeMultiPlatformResult({
      platforms: [
        {
          platform: "google",
          status: "error" as const,
        } as PlatformResult,
      ],
    });

    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("## GOOGLE — Error");
    expect(output).toContain("Unknown error");
  });

  it("includes portfolio actions when present", () => {
    const portfolioActions: PortfolioAction[] = [
      {
        priority: 1,
        action: "Shift 20% budget from Meta to Google Ads",
        platforms: ["meta", "google"],
        confidenceScore: 0.85,
        estimatedRevenueRecovery: 5000,
        riskLevel: "medium",
        requiredBudgetShiftPercent: 20,
      },
      {
        priority: 2,
        action: "Pause underperforming TikTok campaigns",
        platforms: ["tiktok"],
        confidenceScore: 0.92,
        estimatedRevenueRecovery: 2000,
        riskLevel: "low",
        requiredBudgetShiftPercent: null,
      },
    ];

    const result = makeMultiPlatformResult({ portfolioActions });
    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("## Portfolio Actions");
    expect(output).toContain(
      "1. [MEDIUM RISK] Shift 20% budget from Meta to Google Ads (85% confidence | est. $5000 recovery)",
    );
    expect(output).toContain(
      "2. [LOW RISK] Pause underperforming TikTok campaigns (92% confidence | est. $2000 recovery)",
    );
  });

  it("omits portfolio actions section when empty", () => {
    const result = makeMultiPlatformResult({ portfolioActions: [] });
    const output = formatMultiPlatformDiagnostic(result);

    expect(output).not.toContain("## Portfolio Actions");
  });

  it("omits portfolio actions section when undefined", () => {
    const result = makeMultiPlatformResult({ portfolioActions: undefined });
    const output = formatMultiPlatformDiagnostic(result);

    expect(output).not.toContain("## Portfolio Actions");
  });

  it("formats portfolio actions without revenue recovery", () => {
    const portfolioActions: PortfolioAction[] = [
      {
        priority: 1,
        action: "Enable campaign budget optimization",
        platforms: ["meta"],
        confidenceScore: 0.78,
        estimatedRevenueRecovery: 0,
        riskLevel: "low",
        requiredBudgetShiftPercent: null,
      },
    ];

    const result = makeMultiPlatformResult({ portfolioActions });
    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("1. [LOW RISK] Enable campaign budget optimization (78% confidence)");
    expect(output).not.toContain("$0 recovery");
  });

  it("formats all risk levels correctly", () => {
    const portfolioActions: PortfolioAction[] = [
      {
        priority: 1,
        action: "Action 1",
        platforms: ["meta"],
        confidenceScore: 0.9,
        estimatedRevenueRecovery: 1000,
        riskLevel: "low",
        requiredBudgetShiftPercent: null,
      },
      {
        priority: 2,
        action: "Action 2",
        platforms: ["google"],
        confidenceScore: 0.8,
        estimatedRevenueRecovery: 2000,
        riskLevel: "medium",
        requiredBudgetShiftPercent: null,
      },
      {
        priority: 3,
        action: "Action 3",
        platforms: ["tiktok"],
        confidenceScore: 0.7,
        estimatedRevenueRecovery: 3000,
        riskLevel: "high",
        requiredBudgetShiftPercent: null,
      },
    ];

    const result = makeMultiPlatformResult({ portfolioActions });
    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("[LOW RISK]");
    expect(output).toContain("[MEDIUM RISK]");
    expect(output).toContain("[HIGH RISK]");
  });

  it("separates sections with horizontal rules", () => {
    const result = makeMultiPlatformResult();
    const output = formatMultiPlatformDiagnostic(result);

    // Should have separators between summary and platforms
    const lines = output.split("\n");
    const separators = lines.filter((line) => line === "---");

    // At least 2 separators: after summary and between platforms
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });

  it("handles mixed success and error platforms", () => {
    const result = makeMultiPlatformResult({
      platforms: [
        {
          platform: "meta",
          status: "success" as const,
          result: makeDiagnosticResult("meta"),
        },
        {
          platform: "google",
          status: "error" as const,
          error: "Rate limit exceeded",
        },
        {
          platform: "tiktok",
          status: "success" as const,
          result: makeDiagnosticResult("tiktok"),
        },
      ],
    });

    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("## Funnel Diagnostic: act_123 (META)");
    expect(output).toContain("## GOOGLE — Error");
    expect(output).toContain("Rate limit exceeded");
    expect(output).toContain("## Funnel Diagnostic: act_123 (TIKTOK)");
  });

  it("preserves platform-specific findings in detailed reports", () => {
    const metaResult = makeDiagnosticResult("meta", {
      findings: [
        {
          severity: "critical" as Severity,
          stage: "purchase",
          message: "Meta conversion tracking broken",
          recommendation: "Check Meta pixel",
        },
      ],
    });

    const googleResult = makeDiagnosticResult("google", {
      findings: [
        {
          severity: "warning" as Severity,
          stage: "click",
          message: "Google CPC increased 30%",
          recommendation: "Review bid strategy",
        },
      ],
    });

    const result = makeMultiPlatformResult({
      platforms: [
        { platform: "meta", status: "success" as const, result: metaResult },
        { platform: "google", status: "success" as const, result: googleResult },
      ],
    });

    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("Meta conversion tracking broken");
    expect(output).toContain("Check Meta pixel");
    expect(output).toContain("Google CPC increased 30%");
    expect(output).toContain("Review bid strategy");
  });

  it("handles empty platforms array", () => {
    const result = makeMultiPlatformResult({
      platforms: [],
      executiveSummary: "No platforms configured",
    });

    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("No platforms configured");
    expect(output).not.toContain("## Funnel Diagnostic");
  });

  it("includes correlations in crossPlatformFindings (pass-through)", () => {
    // Note: formatMultiPlatformDiagnostic doesn't currently format crossPlatformFindings,
    // but we test that it doesn't break if they're present
    const result = makeMultiPlatformResult({
      crossPlatformFindings: [
        {
          signal: "market_wide_cpm_increase",
          severity: "warning" as Severity,
          platforms: ["meta", "google"],
          message: "CPM increased 25% across all platforms",
          recommendation: "Market-wide spike, monitor trends",
          confidenceScore: 0.88,
        },
      ],
    });

    const output = formatMultiPlatformDiagnostic(result);

    // Should not error even if crossPlatformFindings are present
    expect(output).toBeDefined();
    expect(output).toContain(result.executiveSummary);
  });

  it("includes budget recommendations (pass-through)", () => {
    // Note: formatMultiPlatformDiagnostic doesn't currently format budgetRecommendations,
    // but we test that it doesn't break if they're present
    const result = makeMultiPlatformResult({
      budgetRecommendations: [
        {
          from: "meta",
          to: "google",
          reason: "Google has higher ROAS",
          confidence: "high",
          suggestedShiftPercent: 15,
        },
      ],
    });

    const output = formatMultiPlatformDiagnostic(result);

    // Should not error even if budgetRecommendations are present
    expect(output).toBeDefined();
    expect(output).toContain(result.executiveSummary);
  });

  it("formats platform results even without findings", () => {
    const result = makeMultiPlatformResult({
      platforms: [
        {
          platform: "meta",
          status: "success" as const,
          result: makeDiagnosticResult("meta", { findings: [] }),
        },
      ],
    });

    const output = formatMultiPlatformDiagnostic(result);

    expect(output).toContain("## Funnel Diagnostic: act_123 (META)");
    expect(output).toContain("### Primary KPI");
    expect(output).not.toContain("### Findings");
  });

  it("formats confidence scores as percentages", () => {
    const portfolioActions: PortfolioAction[] = [
      {
        priority: 1,
        action: "Test action",
        platforms: ["meta"],
        confidenceScore: 0.955,
        estimatedRevenueRecovery: 1000,
        riskLevel: "low",
        requiredBudgetShiftPercent: null,
      },
    ];

    const result = makeMultiPlatformResult({ portfolioActions });
    const output = formatMultiPlatformDiagnostic(result);

    // Should round to 96% (0.955 * 100 = 95.5, rounds to 96)
    expect(output).toContain("(96% confidence");
  });
});

describe("runMultiPlatformDiagnostic re-export", () => {
  it("re-exports runMultiPlatformDiagnostic from orchestrator", async () => {
    const { runMultiPlatformDiagnostic } = await import("../multi-platform-diagnostic.js");

    expect(runMultiPlatformDiagnostic).toBeDefined();
    expect(typeof runMultiPlatformDiagnostic).toBe("function");
  });
});
