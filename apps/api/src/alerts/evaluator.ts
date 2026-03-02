export interface AlertEvaluation {
  triggered: boolean;
  metricValue: number;
  threshold: number;
  description: string;
}

interface AlertRuleInput {
  metricPath: string;
  operator: string;
  threshold: number;
}

/**
 * Extract a metric value from a DiagnosticResult using a dot-path.
 * Supported paths:
 * - primaryKPI.current / primaryKPI.deltaPercent
 * - spend.current
 * - findings.critical.count / findings.warning.count
 * - bottleneck.deltaPercent
 */
export function extractMetricValue(path: string, result: Record<string, unknown>): number | null {
  if (path === "findings.critical.count" || path === "findings.warning.count") {
    const severity = path === "findings.critical.count" ? "critical" : "warning";
    const findings = result.findings as Array<{ severity?: string }> | undefined;
    if (!Array.isArray(findings)) return 0;
    return findings.filter((f) => f.severity === severity).length;
  }

  if (path === "bottleneck.deltaPercent") {
    const bottleneck = result.bottleneck as Record<string, unknown> | null;
    if (!bottleneck) return null;
    return typeof bottleneck.deltaPercent === "number" ? bottleneck.deltaPercent : null;
  }

  // Dot-path resolution for simple nested values
  const parts = path.split(".");
  let current: unknown = result;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "number" ? current : null;
}

/**
 * Compare a value against a threshold using the specified operator.
 */
export function compareValue(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
    case "pctChange_gt": return Math.abs(value) > threshold;
    case "pctChange_lt": return Math.abs(value) < threshold;
    default: return false;
  }
}

function operatorLabel(operator: string): string {
  switch (operator) {
    case "gt": return ">";
    case "gte": return ">=";
    case "lt": return "<";
    case "lte": return "<=";
    case "eq": return "==";
    case "pctChange_gt": return "|%change| >";
    case "pctChange_lt": return "|%change| <";
    default: return operator;
  }
}

/**
 * Evaluate a single alert rule against a diagnostic result.
 * Pure function — no side effects.
 */
export function evaluateAlertRule(
  rule: AlertRuleInput,
  result: Record<string, unknown>,
): AlertEvaluation {
  const metricValue = extractMetricValue(rule.metricPath, result);

  if (metricValue === null) {
    return {
      triggered: false,
      metricValue: 0,
      threshold: rule.threshold,
      description: `Metric "${rule.metricPath}" not available in diagnostic result`,
    };
  }

  const triggered = compareValue(metricValue, rule.operator, rule.threshold);

  return {
    triggered,
    metricValue,
    threshold: rule.threshold,
    description: triggered
      ? `Alert triggered: ${rule.metricPath} = ${metricValue} ${operatorLabel(rule.operator)} ${rule.threshold}`
      : `No alert: ${rule.metricPath} = ${metricValue} (threshold: ${operatorLabel(rule.operator)} ${rule.threshold})`,
  };
}
