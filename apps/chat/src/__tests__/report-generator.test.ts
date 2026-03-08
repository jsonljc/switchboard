// ---------------------------------------------------------------------------
// Tests — Report Generator
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { generateReport } from "../composer/report-generator.js";
import type { DiagnosticResult } from "@switchboard/digital-ads";

function makeDiagnostic(overrides?: Partial<DiagnosticResult>): DiagnosticResult {
  return {
    vertical: "commerce",
    entityId: "act_123456",
    platform: "meta",
    periods: {
      current: { since: "2026-02-28", until: "2026-03-07" },
      previous: { since: "2026-02-21", until: "2026-02-28" },
    },
    spend: { current: 1500, previous: 1200 },
    primaryKPI: {
      name: "ROAS",
      current: 3.5,
      previous: 4.2,
      deltaPercent: -16.7,
      severity: "warning",
    },
    stageAnalysis: [
      {
        stageName: "Impressions",
        metric: "impressions",
        currentValue: 50000,
        previousValue: 45000,
        delta: 5000,
        deltaPercent: 11.1,
        isSignificant: true,
        severity: "healthy",
      },
      {
        stageName: "Clicks",
        metric: "clicks",
        currentValue: 1500,
        previousValue: 1800,
        delta: -300,
        deltaPercent: -16.7,
        isSignificant: true,
        severity: "warning",
      },
    ],
    dropoffs: [
      {
        fromStage: "Impressions",
        toStage: "Clicks",
        currentRate: 0.03,
        previousRate: 0.04,
        deltaPercent: -25,
      },
    ],
    bottleneck: {
      stageName: "Clicks",
      metric: "clicks",
      currentValue: 1500,
      previousValue: 1800,
      delta: -300,
      deltaPercent: -16.7,
      isSignificant: true,
      severity: "warning",
    },
    findings: [
      {
        severity: "critical",
        stage: "CTR",
        message: "Creative fatigue detected: CTR dropped 35%",
        recommendation: "Refresh ad creatives with new angles",
      },
      {
        severity: "warning",
        stage: "CPC",
        message: "Cost per click increased 22% WoW",
        recommendation: "Review bid strategy",
      },
      {
        severity: "healthy",
        stage: "Impressions",
        message: "Impression volume is healthy",
        recommendation: null,
      },
    ],
    ...overrides,
  };
}

describe("generateReport — Markdown", () => {
  it("generates a markdown report with all sections", () => {
    const diagnostic = makeDiagnostic();
    const report = generateReport(diagnostic, { format: "markdown" });

    expect(report.format).toBe("markdown");
    expect(report.title).toContain("Ad Performance Report");
    expect(report.findingsCount.critical).toBe(1);
    expect(report.findingsCount.warning).toBe(1);
    expect(report.findingsCount.healthy).toBe(1);

    // Check structure
    expect(report.content).toContain("# ");
    expect(report.content).toContain("## Executive Summary");
    expect(report.content).toContain("## Findings");
    expect(report.content).toContain("## Stage Analysis");
    expect(report.content).toContain("## Funnel Drop-offs");
    expect(report.content).toContain("## Bottleneck");

    // Check data appears
    expect(report.content).toContain("$1500.00");
    expect(report.content).toContain("ROAS");
    expect(report.content).toContain("Creative fatigue");
    expect(report.content).toContain("Impressions");
    expect(report.content).toContain("Clicks");
    expect(report.content).toContain("Refresh ad creatives");
  });

  it("uses custom title and business name", () => {
    const report = generateReport(makeDiagnostic(), {
      format: "markdown",
      businessName: "Acme Corp",
      title: "Weekly Performance Review",
    });

    expect(report.title).toBe("Weekly Performance Review");
    expect(report.content).toContain("Weekly Performance Review");
  });

  it("generates default title from business name", () => {
    const report = generateReport(makeDiagnostic(), {
      format: "markdown",
      businessName: "Acme Corp",
    });

    expect(report.title).toContain("Acme Corp");
  });

  it("includes recommendations when provided", () => {
    const report = generateReport(makeDiagnostic(), {
      format: "markdown",
      recommendations: {
        proposals: [
          {
            finding: {
              severity: "critical",
              stage: "CTR",
              message: "Creative fatigue",
              recommendation: null,
            },
            actionType: "digital-ads.funnel.diagnose",
            parameters: { platform: "meta", entityId: "act_123" },
            confidence: 0.85,
            rationale: "Creative fatigue detected — run a deeper analysis",
            expectedImpact: "Identify fatigued creatives",
            riskLevel: "low",
          },
        ],
        unactionable: [],
        summary: {
          totalFindings: 1,
          actionableCount: 1,
          unactionableCount: 0,
          highestConfidence: 0.85,
        },
      },
    });

    expect(report.content).toContain("## Recommended Actions");
    expect(report.content).toContain("85%");
    expect(report.content).toContain("Creative fatigue");
  });

  it("includes economic impact when present", () => {
    const report = generateReport(
      makeDiagnostic({
        elasticity: {
          totalEstimatedRevenueLoss: 2500,
          impactRanking: [
            { stage: "Clicks", estimatedRevenueDelta: -1500, severity: "critical" },
            { stage: "ATC", estimatedRevenueDelta: -1000, severity: "warning" },
          ],
        },
      }),
      { format: "markdown" },
    );

    expect(report.content).toContain("## Economic Impact");
    expect(report.content).toContain("$2500.00");
  });

  it("omits stage analysis when disabled", () => {
    const report = generateReport(makeDiagnostic(), {
      format: "markdown",
      includeStageAnalysis: false,
    });

    expect(report.content).not.toContain("## Stage Analysis");
  });

  it("omits drop-offs when disabled", () => {
    const report = generateReport(makeDiagnostic(), {
      format: "markdown",
      includeDropoffs: false,
    });

    expect(report.content).not.toContain("## Funnel Drop-offs");
  });
});

describe("generateReport — HTML", () => {
  it("generates a valid HTML document", () => {
    const report = generateReport(makeDiagnostic(), { format: "html" });

    expect(report.format).toBe("html");
    expect(report.content).toContain("<!DOCTYPE html>");
    expect(report.content).toContain("<html");
    expect(report.content).toContain("</html>");
    expect(report.content).toContain("<style>");
  });

  it("contains severity badges", () => {
    const report = generateReport(makeDiagnostic(), { format: "html" });

    expect(report.content).toContain("badge-critical");
    expect(report.content).toContain("badge-warning");
    expect(report.content).toContain("badge-healthy");
  });

  it("contains findings with recommendations", () => {
    const report = generateReport(makeDiagnostic(), { format: "html" });

    expect(report.content).toContain("Creative fatigue");
    expect(report.content).toContain("Refresh ad creatives");
    expect(report.content).toContain("Cost per click");
  });

  it("contains stage analysis table", () => {
    const report = generateReport(makeDiagnostic(), { format: "html" });

    expect(report.content).toContain("Stage Analysis");
    expect(report.content).toContain("Impressions");
    expect(report.content).toContain("50.0K");
  });

  it("escapes HTML in finding messages", () => {
    const report = generateReport(
      makeDiagnostic({
        findings: [
          {
            severity: "warning",
            stage: "Test",
            message: 'Value <script>alert("xss")</script>',
            recommendation: null,
          },
        ],
      }),
      { format: "html" },
    );

    expect(report.content).not.toContain("<script>");
    expect(report.content).toContain("&lt;script&gt;");
  });

  it("includes recommendations section in HTML", () => {
    const report = generateReport(makeDiagnostic(), {
      format: "html",
      recommendations: {
        proposals: [
          {
            finding: {
              severity: "critical",
              stage: "CTR",
              message: "Fatigue",
              recommendation: null,
            },
            actionType: "digital-ads.funnel.diagnose",
            parameters: {},
            confidence: 0.9,
            rationale: "Creative fatigue detected — investigate",
            expectedImpact: "Reduce wasted spend",
            riskLevel: "low",
          },
        ],
        unactionable: [],
        summary: {
          totalFindings: 1,
          actionableCount: 1,
          unactionableCount: 0,
          highestConfidence: 0.9,
        },
      },
    });

    expect(report.content).toContain("Recommended Actions");
    expect(report.content).toContain("90%");
  });

  it("handles empty findings gracefully", () => {
    const report = generateReport(makeDiagnostic({ findings: [] }), { format: "html" });

    expect(report.content).toContain("<!DOCTYPE html>");
    expect(report.findingsCount.critical).toBe(0);
  });
});
