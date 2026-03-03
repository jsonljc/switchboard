import { describe, it, expect } from "vitest";
import { generateSummary } from "../summary.js";
import type { JourneyDiagnosticResult } from "../../core/types.js";

function makeResult(overrides: Partial<JourneyDiagnosticResult> = {}): JourneyDiagnosticResult {
  return {
    organizationId: "clinic-alpha",
    periods: {
      current: { since: "2025-01-01", until: "2025-01-31" },
      previous: { since: "2024-12-01", until: "2024-12-31" },
    },
    totalPatients: { current: 120, previous: 100 },
    primaryKPI: {
      name: "treatments_completed",
      current: 50,
      previous: 45,
      deltaPercent: 11.1,
      severity: "healthy",
    },
    stageAnalysis: [],
    dropoffs: [],
    bottleneck: null,
    findings: [],
    ...overrides,
  };
}

describe("generateSummary", () => {
  it("includes header with organization and period", () => {
    const summary = generateSummary(makeResult());
    expect(summary).toContain("Patient Pipeline Diagnostic — clinic-alpha");
    expect(summary).toContain("Period: 2025-01-01 to 2025-01-31");
  });

  it("shows KPI direction as 'up' for positive delta", () => {
    const summary = generateSummary(makeResult());
    expect(summary).toContain("Primary KPI (treatments_completed): 50 (up 11.1%)");
  });

  it("shows KPI direction as 'down' for negative delta", () => {
    const result = makeResult({
      primaryKPI: {
        name: "treatments_completed",
        current: 40,
        previous: 50,
        deltaPercent: -20,
        severity: "warning",
      },
    });
    const summary = generateSummary(result);
    expect(summary).toContain("(down 20.0%)");
  });

  it("shows total patients comparison", () => {
    const summary = generateSummary(makeResult());
    expect(summary).toContain("Total patients: 120 (was 100)");
  });

  it("shows bottleneck when present", () => {
    const result = makeResult({
      bottleneck: {
        stageName: "Qualified",
        stageId: "qualified",
        metric: "qualified_leads",
        currentValue: 30,
        previousValue: 50,
        delta: -20,
        deltaPercent: -40,
        isSignificant: true,
        severity: "critical",
      },
    });
    const summary = generateSummary(result);
    expect(summary).toContain("Bottleneck: Qualified (-40.0%)");
  });

  it("shows 'None detected' when no bottleneck", () => {
    const summary = generateSummary(makeResult());
    expect(summary).toContain("Bottleneck: None detected");
  });

  it("shows finding counts by severity", () => {
    const result = makeResult({
      findings: [
        { severity: "critical", stage: "s1", message: "Critical issue", recommendation: null },
        { severity: "warning", stage: "s2", message: "Warning 1", recommendation: null },
        { severity: "warning", stage: "s3", message: "Warning 2", recommendation: null },
        { severity: "info", stage: "s4", message: "Info note", recommendation: null },
        { severity: "healthy", stage: "s5", message: "All good", recommendation: null },
      ],
    });
    const summary = generateSummary(result);
    expect(summary).toContain("Findings: 1 critical, 2 warnings, 1 info, 1 healthy");
  });

  it("shows top issues (critical and warning, max 5)", () => {
    const result = makeResult({
      findings: [
        { severity: "critical", stage: "s1", message: "Big problem", recommendation: null },
        { severity: "warning", stage: "s2", message: "Medium problem", recommendation: null },
        { severity: "info", stage: "s3", message: "Minor note", recommendation: null },
      ],
    });
    const summary = generateSummary(result);
    expect(summary).toContain("Top issues:");
    expect(summary).toContain("[CRITICAL] Big problem");
    expect(summary).toContain("[WARNING] Medium problem");
    expect(summary).not.toContain("[INFO] Minor note");
  });

  it("omits top issues section when no critical/warning findings", () => {
    const result = makeResult({
      findings: [
        { severity: "info", stage: "s1", message: "Info only", recommendation: null },
        { severity: "healthy", stage: "s2", message: "All good", recommendation: null },
      ],
    });
    const summary = generateSummary(result);
    expect(summary).not.toContain("Top issues:");
  });

  it("limits top issues to 5", () => {
    const result = makeResult({
      findings: Array.from({ length: 8 }, (_, i) => ({
        severity: "warning" as const,
        stage: `s${i}`,
        message: `Issue ${i + 1}`,
        recommendation: null,
      })),
    });
    const summary = generateSummary(result);
    expect(summary).toContain("[WARNING] Issue 5");
    expect(summary).not.toContain("[WARNING] Issue 6");
  });
});
