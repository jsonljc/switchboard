import { describe, it, expect } from "vitest";
import { evaluateAlertRule, extractMetricValue, compareValue } from "../evaluator.js";

describe("extractMetricValue", () => {
  const result = {
    primaryKPI: { name: "ROAS", current: 3.5, previous: 4.0, deltaPercent: -12.5, severity: "warning" },
    spend: { current: 1500, previous: 1200 },
    bottleneck: { stage: "checkout", deltaPercent: -25.3 },
    findings: [
      { severity: "critical", message: "ROAS dropped" },
      { severity: "critical", message: "Spend spike" },
      { severity: "warning", message: "CTR declining" },
      { severity: "info", message: "Normal variance" },
    ],
  };

  it("extracts primaryKPI.current", () => {
    expect(extractMetricValue("primaryKPI.current", result)).toBe(3.5);
  });

  it("extracts primaryKPI.deltaPercent", () => {
    expect(extractMetricValue("primaryKPI.deltaPercent", result)).toBe(-12.5);
  });

  it("extracts spend.current", () => {
    expect(extractMetricValue("spend.current", result)).toBe(1500);
  });

  it("extracts bottleneck.deltaPercent", () => {
    expect(extractMetricValue("bottleneck.deltaPercent", result)).toBe(-25.3);
  });

  it("counts critical findings", () => {
    expect(extractMetricValue("findings.critical.count", result)).toBe(2);
  });

  it("counts warning findings", () => {
    expect(extractMetricValue("findings.warning.count", result)).toBe(1);
  });

  it("returns 0 for findings count when no findings array", () => {
    expect(extractMetricValue("findings.critical.count", {})).toBe(0);
  });

  it("returns null for missing bottleneck", () => {
    expect(extractMetricValue("bottleneck.deltaPercent", { bottleneck: null })).toBeNull();
  });

  it("returns null for completely missing path", () => {
    expect(extractMetricValue("nonexistent.path", {})).toBeNull();
  });
});

describe("compareValue", () => {
  it("gt: 10 > 5 = true", () => {
    expect(compareValue(10, "gt", 5)).toBe(true);
  });

  it("gt: 5 > 10 = false", () => {
    expect(compareValue(5, "gt", 10)).toBe(false);
  });

  it("gte: 5 >= 5 = true", () => {
    expect(compareValue(5, "gte", 5)).toBe(true);
  });

  it("lt: 3 < 5 = true", () => {
    expect(compareValue(3, "lt", 5)).toBe(true);
  });

  it("lte: 5 <= 5 = true", () => {
    expect(compareValue(5, "lte", 5)).toBe(true);
  });

  it("eq: 5 == 5 = true", () => {
    expect(compareValue(5, "eq", 5)).toBe(true);
  });

  it("eq: 5 == 6 = false", () => {
    expect(compareValue(5, "eq", 6)).toBe(false);
  });

  it("pctChange_gt: |-12.5| > 10 = true", () => {
    expect(compareValue(-12.5, "pctChange_gt", 10)).toBe(true);
  });

  it("pctChange_gt: |-5| > 10 = false", () => {
    expect(compareValue(-5, "pctChange_gt", 10)).toBe(false);
  });

  it("pctChange_lt: |-3| < 10 = true", () => {
    expect(compareValue(-3, "pctChange_lt", 10)).toBe(true);
  });

  it("unknown operator returns false", () => {
    expect(compareValue(5, "unknown", 5)).toBe(false);
  });
});

describe("evaluateAlertRule", () => {
  const diagnosticResult = {
    primaryKPI: { name: "ROAS", current: 3.5, previous: 4.0, deltaPercent: -12.5, severity: "warning" },
    spend: { current: 1500, previous: 1200 },
    bottleneck: { stage: "checkout", deltaPercent: -25.3 },
    findings: [
      { severity: "critical", message: "ROAS dropped" },
      { severity: "warning", message: "CTR declining" },
    ],
  };

  it("triggers when primaryKPI.current < threshold", () => {
    const evaluation = evaluateAlertRule(
      { metricPath: "primaryKPI.current", operator: "lt", threshold: 4.0 },
      diagnosticResult,
    );
    expect(evaluation.triggered).toBe(true);
    expect(evaluation.metricValue).toBe(3.5);
    expect(evaluation.threshold).toBe(4.0);
    expect(evaluation.description).toContain("Alert triggered");
  });

  it("does not trigger when spend.current < threshold", () => {
    const evaluation = evaluateAlertRule(
      { metricPath: "spend.current", operator: "gt", threshold: 2000 },
      diagnosticResult,
    );
    expect(evaluation.triggered).toBe(false);
    expect(evaluation.metricValue).toBe(1500);
    expect(evaluation.description).toContain("No alert");
  });

  it("triggers on critical findings count", () => {
    const evaluation = evaluateAlertRule(
      { metricPath: "findings.critical.count", operator: "gte", threshold: 1 },
      diagnosticResult,
    );
    expect(evaluation.triggered).toBe(true);
    expect(evaluation.metricValue).toBe(1);
  });

  it("triggers on pctChange_gt for deltaPercent", () => {
    const evaluation = evaluateAlertRule(
      { metricPath: "primaryKPI.deltaPercent", operator: "pctChange_gt", threshold: 10 },
      diagnosticResult,
    );
    expect(evaluation.triggered).toBe(true);
    expect(evaluation.metricValue).toBe(-12.5);
  });

  it("returns not triggered when metric path is unavailable", () => {
    const evaluation = evaluateAlertRule(
      { metricPath: "nonexistent.metric", operator: "gt", threshold: 0 },
      diagnosticResult,
    );
    expect(evaluation.triggered).toBe(false);
    expect(evaluation.description).toContain("not available");
  });

  it("evaluates bottleneck.deltaPercent", () => {
    const evaluation = evaluateAlertRule(
      { metricPath: "bottleneck.deltaPercent", operator: "lt", threshold: -20 },
      diagnosticResult,
    );
    expect(evaluation.triggered).toBe(true);
    expect(evaluation.metricValue).toBe(-25.3);
  });
});
