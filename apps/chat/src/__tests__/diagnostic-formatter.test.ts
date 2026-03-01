import { describe, it, expect } from "vitest";
import {
  formatDiagnosticResult,
  isDiagnosticAction,
} from "../formatters/diagnostic-formatter.js";

describe("isDiagnosticAction", () => {
  it("returns true for diagnostic action types", () => {
    expect(isDiagnosticAction("digital-ads.funnel.diagnose")).toBe(true);
    expect(isDiagnosticAction("digital-ads.portfolio.diagnose")).toBe(true);
    expect(isDiagnosticAction("digital-ads.snapshot.fetch")).toBe(true);
    expect(isDiagnosticAction("digital-ads.structure.analyze")).toBe(true);
  });

  it("returns false for non-diagnostic action types", () => {
    expect(isDiagnosticAction("digital-ads.campaign.pause")).toBe(false);
    expect(isDiagnosticAction("payments.refund.create")).toBe(false);
    expect(isDiagnosticAction("")).toBe(false);
  });
});

describe("formatDiagnosticResult", () => {
  it("returns fallback for null data", () => {
    const result = formatDiagnosticResult("digital-ads.funnel.diagnose", null);
    expect(result).toContain("no data");
  });

  it("returns fallback for unknown action type", () => {
    const result = formatDiagnosticResult("unknown.action", { foo: "bar" });
    expect(result).toBe("Diagnostic completed.");
  });
});

describe("formatFunnelDiagnostic", () => {
  const fullData = {
    vertical: "commerce",
    platform: "meta",
    periods: {
      current: { since: "2025-02-22", until: "2025-02-28" },
      previous: { since: "2025-02-15", until: "2025-02-21" },
    },
    primaryKPI: {
      name: "purchase",
      current: 142,
      previous: 168,
      deltaPercent: -15.5,
      severity: "warning",
    },
    stageAnalysis: [
      {
        stageName: "impressions",
        currentValue: 423000,
        previousValue: 452000,
        deltaPercent: -6.4,
        severity: "info",
      },
      {
        stageName: "clicks",
        currentValue: 10800,
        previousValue: 12400,
        deltaPercent: -12.9,
        severity: "warning",
      },
    ],
    bottleneck: {
      stageName: "clicks",
      deltaPercent: -12.9,
    },
    findings: [
      {
        severity: "critical",
        message: "Click-through rate dropped — check creative fatigue",
        recommendation: "Rotate ad creatives",
      },
      {
        severity: "warning",
        message: "Purchase conversion rate declined",
        recommendation: null,
      },
    ],
    elasticity: {
      totalEstimatedRevenueLoss: -2340,
    },
  };

  it("produces readable funnel report with all sections", () => {
    const result = formatDiagnosticResult("digital-ads.funnel.diagnose", fullData);

    expect(result).toContain("Funnel Diagnostic");
    expect(result).toContain("Meta");
    expect(result).toContain("Commerce");
    expect(result).toContain("Feb 22");
    expect(result).toContain("Primary KPI: purchase");
    expect(result).toContain("142");
    expect(result).toContain("168");
    expect(result).toContain("-15.5%");
    expect(result).toContain("[WARNING]");
    expect(result).toContain("Stage Analysis:");
    expect(result).toContain("impressions");
    expect(result).toContain("clicks");
    expect(result).toContain("Bottleneck: clicks");
    expect(result).toContain("Key Findings:");
    expect(result).toContain("[CRITICAL]");
    expect(result).toContain("creative fatigue");
    expect(result).toContain("Rotate ad creatives");
    expect(result).toContain("Revenue Impact");
    expect(result).toContain("$2,340");
  });

  it("handles partial data (no elasticity, no bottleneck)", () => {
    const partial = {
      vertical: "leadgen",
      primaryKPI: {
        name: "lead",
        current: 50,
        previous: 45,
        deltaPercent: 11.1,
        severity: "healthy",
      },
      stageAnalysis: [],
      findings: [],
    };

    const result = formatDiagnosticResult("digital-ads.funnel.diagnose", partial);
    expect(result).toContain("Funnel Diagnostic");
    expect(result).toContain("Primary KPI: lead");
    expect(result).not.toContain("Bottleneck:");
    expect(result).not.toContain("Revenue Impact");
    expect(result).not.toContain("Key Findings:");
  });

  it("handles empty data gracefully", () => {
    const result = formatDiagnosticResult("digital-ads.funnel.diagnose", {});
    expect(result).toContain("Funnel Diagnostic");
    // Should not throw
  });
});

describe("formatPortfolioDiagnostic", () => {
  const fullData = {
    platforms: [
      {
        platform: "meta",
        status: "success",
        result: {
          primaryKPI: {
            name: "purchase",
            current: 142,
            deltaPercent: -15.5,
            severity: "warning",
          },
        },
      },
      {
        platform: "google",
        status: "error",
        error: "API timeout",
      },
    ],
    crossPlatformFindings: [
      {
        severity: "warning",
        message: "CPM increases across all platforms",
        recommendation: "Consider reallocating budget",
      },
    ],
    budgetRecommendations: [
      {
        from: "google",
        to: "meta",
        reason: "Meta has higher ROAS",
        suggestedShiftPercent: 15,
      },
    ],
    executiveSummary: "Overall portfolio health is declining.",
  };

  it("produces per-platform summaries", () => {
    const result = formatDiagnosticResult("digital-ads.portfolio.diagnose", fullData);

    expect(result).toContain("Portfolio Diagnostic Report");
    expect(result).toContain("Overall portfolio health is declining");
    expect(result).toContain("Meta");
    expect(result).toContain("purchase");
    expect(result).toContain("Google");
    expect(result).toContain("Error");
    expect(result).toContain("API timeout");
    expect(result).toContain("Cross-Platform Findings:");
    expect(result).toContain("CPM increases");
    expect(result).toContain("Budget Recommendations:");
    expect(result).toContain("15%");
  });

  it("handles empty portfolio data", () => {
    const result = formatDiagnosticResult("digital-ads.portfolio.diagnose", {});
    expect(result).toContain("Portfolio Diagnostic Report");
  });
});

describe("formatSnapshot", () => {
  const fullData = {
    entityId: "act_123456",
    entityLevel: "account",
    periodStart: "2025-02-22",
    periodEnd: "2025-02-28",
    spend: 4500.5,
    topLevel: {
      ctr: 0.032,
      cpm: 12.5,
      cpc: 0.85,
    },
    stages: {
      impressions: { count: 452000, cost: null },
      clicks: { count: 12400, cost: 10540.0 },
      purchase: { count: 142, cost: 4500.5 },
    },
  };

  it("produces compact metrics table", () => {
    const result = formatDiagnosticResult("digital-ads.snapshot.fetch", fullData);

    expect(result).toContain("Metrics Snapshot");
    expect(result).toContain("act_123456");
    expect(result).toContain("account");
    expect(result).toContain("$4,500.50");
    expect(result).toContain("CTR");
    expect(result).toContain("CPM");
    expect(result).toContain("CPC");
    expect(result).toContain("Funnel Stages:");
    expect(result).toContain("impressions");
    expect(result).toContain("clicks");
    expect(result).toContain("purchase");
  });

  it("handles empty snapshot data", () => {
    const result = formatDiagnosticResult("digital-ads.snapshot.fetch", {});
    expect(result).toContain("Metrics Snapshot");
  });
});

describe("formatStructureAnalysis", () => {
  const fullData = {
    subEntities: [
      {
        entityId: "adset_001",
        entityLevel: "adset",
        spend: 1200,
        conversions: 15,
        daysSinceLastEdit: 3,
        inLearningPhase: true,
        dailyBudget: 200,
      },
      {
        entityId: "adset_002",
        entityLevel: "adset",
        spend: 800,
        conversions: 2,
        daysSinceLastEdit: 30,
        inLearningPhase: false,
        dailyBudget: null,
      },
    ],
    findings: [
      {
        severity: "warning",
        message: "Budget skew detected — top ad set has 60% of spend",
        recommendation: "Consider redistributing budget",
      },
      {
        severity: "info",
        message: "1 ad set in learning phase",
        recommendation: null,
      },
    ],
  };

  it("produces structural findings report", () => {
    const result = formatDiagnosticResult("digital-ads.structure.analyze", fullData);

    expect(result).toContain("Campaign Structure Analysis");
    expect(result).toContain("Sub-Entities:");
    expect(result).toContain("adset_001");
    expect(result).toContain("LEARNING");
    expect(result).toContain("edited 3d ago");
    expect(result).toContain("adset_002");
    expect(result).toContain("Structural Findings:");
    expect(result).toContain("[WARNING]");
    expect(result).toContain("Budget skew");
    expect(result).toContain("Consider redistributing");
    expect(result).toContain("[INFO]");
  });

  it("handles empty structure data", () => {
    const result = formatDiagnosticResult("digital-ads.structure.analyze", {});
    expect(result).toContain("Campaign Structure Analysis");
    expect(result).toContain("No structural issues detected");
  });

  it("handles partial data (findings only, no sub-entities)", () => {
    const partial = {
      findings: [
        {
          severity: "critical",
          message: "Too many ad sets",
          recommendation: "Consolidate",
        },
      ],
    };
    const result = formatDiagnosticResult("digital-ads.structure.analyze", partial);
    expect(result).toContain("[CRITICAL]");
    expect(result).toContain("Too many ad sets");
    expect(result).not.toContain("No structural issues");
  });
});
