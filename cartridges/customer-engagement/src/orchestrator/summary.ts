// ---------------------------------------------------------------------------
// Executive Summary Generator
// ---------------------------------------------------------------------------

import type { JourneyDiagnosticResult, Severity } from "../core/types.js";

/**
 * Generate a concise executive summary from a diagnostic result.
 */
export function generateSummary(result: JourneyDiagnosticResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`Patient Pipeline Diagnostic — ${result.organizationId}`);
  lines.push(`Period: ${result.periods.current.since} to ${result.periods.current.until}`);
  lines.push("");

  // KPI summary
  const kpi = result.primaryKPI;
  const direction = kpi.deltaPercent >= 0 ? "up" : "down";
  lines.push(
    `Primary KPI (${kpi.name}): ${kpi.current} (${direction} ${Math.abs(kpi.deltaPercent).toFixed(1)}%)`,
  );
  lines.push(
    `Total contacts: ${result.totalContacts.current} (was ${result.totalContacts.previous})`,
  );
  lines.push("");

  // Bottleneck
  if (result.bottleneck) {
    lines.push(
      `Bottleneck: ${result.bottleneck.stageName} (${result.bottleneck.deltaPercent.toFixed(1)}%)`,
    );
  } else {
    lines.push("Bottleneck: None detected");
  }
  lines.push("");

  // Finding counts by severity
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0, healthy: 0 };
  for (const f of result.findings) {
    counts[f.severity]++;
  }
  lines.push(
    `Findings: ${counts.critical} critical, ${counts.warning} warnings, ${counts.info} info, ${counts.healthy} healthy`,
  );

  // Top findings
  const topFindings = result.findings
    .filter((f) => f.severity === "critical" || f.severity === "warning")
    .slice(0, 5);
  if (topFindings.length > 0) {
    lines.push("");
    lines.push("Top issues:");
    for (const f of topFindings) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.message}`);
    }
  }

  return lines.join("\n");
}
