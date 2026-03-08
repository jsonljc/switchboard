// ---------------------------------------------------------------------------
// Comparison Report Formatter
// ---------------------------------------------------------------------------

import type { ComparisonReport } from "../types.js";

export function formatComparisonReport(report: ComparisonReport): string {
  const lines: string[] = [
    `Period Comparison Report`,
    `Current:  ${report.currentPeriod.since} to ${report.currentPeriod.until}`,
    `Previous: ${report.previousPeriod.since} to ${report.previousPeriod.until}`,
    "",
    "Changes:",
  ];

  for (const change of report.changes) {
    const direction = change.percentChange > 0 ? "▲" : change.percentChange < 0 ? "▼" : "—";
    const sign = change.percentChange > 0 ? "+" : "";
    lines.push(
      `  ${change.metric}: ${change.currentValue.toFixed(2)} → ${change.previousValue.toFixed(2)} ` +
        `(${direction} ${sign}${change.percentChange.toFixed(1)}%)`,
    );
  }

  return lines.join("\n");
}
