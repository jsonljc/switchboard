// ---------------------------------------------------------------------------
// Creative Report Formatter
// ---------------------------------------------------------------------------

import type { CreativeReport } from "../types.js";

export function formatCreativeReport(report: CreativeReport): string {
  const lines: string[] = [
    `Creative Report (${report.dateRange.since} to ${report.dateRange.until})`,
    "",
    `Total Creatives: ${report.creatives.length}`,
    "",
  ];

  const sorted = [...report.creatives].sort((a, b) => b.spend - a.spend);

  for (const creative of sorted.slice(0, 20)) {
    lines.push(
      `  ${creative.adName} (${creative.adId})`,
      `    Format: ${creative.format ?? "unknown"} | Spend: $${creative.spend.toFixed(2)}`,
      `    Impressions: ${creative.impressions.toLocaleString()} | Clicks: ${creative.clicks.toLocaleString()}`,
      `    CTR: ${creative.ctr.toFixed(2)}% | CPC: $${creative.cpc.toFixed(2)}` +
        (creative.cpa !== null ? ` | CPA: $${creative.cpa.toFixed(2)}` : ""),
      "",
    );
  }

  return lines.join("\n");
}
