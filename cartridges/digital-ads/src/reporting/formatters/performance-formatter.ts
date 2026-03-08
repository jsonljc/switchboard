// ---------------------------------------------------------------------------
// Performance Report Formatter
// ---------------------------------------------------------------------------

import type { PerformanceReport } from "../types.js";

export function formatPerformanceReport(report: PerformanceReport): string {
  const lines: string[] = [
    `Performance Report (${report.dateRange.since} to ${report.dateRange.until})`,
    `Level: ${report.level}`,
    report.breakdowns.length > 0 ? `Breakdowns: ${report.breakdowns.join(", ")}` : "",
    "",
    "Summary:",
    `  Spend: $${report.summary.totalSpend.toFixed(2)}`,
    `  Impressions: ${report.summary.totalImpressions.toLocaleString()}`,
    `  Clicks: ${report.summary.totalClicks.toLocaleString()}`,
    `  Conversions: ${report.summary.totalConversions.toLocaleString()}`,
    `  CTR: ${report.summary.avgCTR.toFixed(2)}%`,
    `  CPM: $${report.summary.avgCPM.toFixed(2)}`,
    `  CPC: $${report.summary.avgCPC.toFixed(2)}`,
    "",
    `Rows: ${report.rows.length}`,
  ];

  return lines.filter(Boolean).join("\n");
}
