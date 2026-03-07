// ---------------------------------------------------------------------------
// Report Generator — Structured Diagnostic Reports
// ---------------------------------------------------------------------------
// Transforms DiagnosticResult into structured, formatted reports suitable for
// client delivery. Supports HTML (for email/web) and Markdown (for chat).
// ---------------------------------------------------------------------------

import type {
  DiagnosticResult,
  Finding,
  StageDiagnostic,
  FunnelDropoff,
  Severity,
  RecommendationResult,
} from "@switchboard/digital-ads";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportFormat = "html" | "markdown";

export interface ReportOptions {
  format: ReportFormat;
  /** Include recommendations from the RecommendationEngine */
  recommendations?: RecommendationResult;
  /** Business name for the report header */
  businessName?: string;
  /** Report title override */
  title?: string;
  /** Whether to include the full stage analysis table */
  includeStageAnalysis?: boolean;
  /** Whether to include the drop-off table */
  includeDropoffs?: boolean;
}

export interface GeneratedReport {
  content: string;
  format: ReportFormat;
  title: string;
  generatedAt: string;
  findingsCount: { critical: number; warning: number; info: number; healthy: number };
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  healthy: 3,
};

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "\u{1F534}",
  warning: "\u{1F7E1}",
  info: "\u{1F535}",
  healthy: "\u{1F7E2}",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
  healthy: "Healthy",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
  healthy: "#16a34a",
};

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0, healthy: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------

export function generateReport(
  diagnostic: DiagnosticResult,
  options: ReportOptions,
): GeneratedReport {
  const title =
    options.title ??
    `${options.businessName ? options.businessName + " — " : ""}Ad Performance Report`;
  const generatedAt = new Date().toISOString();
  const counts = countBySeverity(diagnostic.findings);

  const content =
    options.format === "html"
      ? generateHTML(diagnostic, options, title, generatedAt, counts)
      : generateMarkdown(diagnostic, options, title, generatedAt, counts);

  return {
    content,
    format: options.format,
    title,
    generatedAt,
    findingsCount: counts,
  };
}

// ---------------------------------------------------------------------------
// Markdown Report
// ---------------------------------------------------------------------------

function generateMarkdown(
  diagnostic: DiagnosticResult,
  options: ReportOptions,
  title: string,
  generatedAt: string,
  counts: Record<Severity, number>,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `**Generated:** ${new Date(generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
  );
  lines.push(
    `**Platform:** ${diagnostic.platform ?? "Unknown"} | **Vertical:** ${diagnostic.vertical} | **Account:** ${diagnostic.entityId}`,
  );
  lines.push(
    `**Period:** ${diagnostic.periods.current.since} to ${diagnostic.periods.current.until}`,
  );
  lines.push("");

  // Executive summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Current Spend | $${diagnostic.spend.current.toFixed(2)} |`);
  lines.push(`| Previous Spend | $${diagnostic.spend.previous.toFixed(2)} |`);
  const spendDelta =
    diagnostic.spend.previous > 0
      ? (
          ((diagnostic.spend.current - diagnostic.spend.previous) / diagnostic.spend.previous) *
          100
        ).toFixed(1)
      : "N/A";
  lines.push(`| Spend Change | ${spendDelta}% |`);
  lines.push(
    `| ${diagnostic.primaryKPI.name} | ${diagnostic.primaryKPI.current.toFixed(2)} (${diagnostic.primaryKPI.deltaPercent > 0 ? "+" : ""}${diagnostic.primaryKPI.deltaPercent.toFixed(1)}%) |`,
  );
  lines.push("");

  // Finding counts
  lines.push("### Finding Summary");
  lines.push("");
  if (counts.critical > 0)
    lines.push(`- ${SEVERITY_EMOJI.critical} **${counts.critical} Critical** issues`);
  if (counts.warning > 0)
    lines.push(`- ${SEVERITY_EMOJI.warning} **${counts.warning} Warning** issues`);
  if (counts.info > 0) lines.push(`- ${SEVERITY_EMOJI.info} **${counts.info} Info** items`);
  if (counts.healthy > 0)
    lines.push(`- ${SEVERITY_EMOJI.healthy} **${counts.healthy} Healthy** metrics`);
  lines.push("");

  // Findings
  if (diagnostic.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");

    const sorted = [...diagnostic.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );

    for (const finding of sorted) {
      lines.push(
        `### ${SEVERITY_EMOJI[finding.severity]} ${SEVERITY_LABEL[finding.severity]} — ${finding.stage}`,
      );
      lines.push("");
      lines.push(finding.message);
      if (finding.recommendation) {
        lines.push("");
        lines.push(`**Recommendation:** ${finding.recommendation}`);
      }
      lines.push("");
    }
  }

  // Stage analysis
  if (options.includeStageAnalysis !== false && diagnostic.stageAnalysis.length > 0) {
    lines.push("## Stage Analysis");
    lines.push("");
    lines.push("| Stage | Current | Previous | Change | Severity |");
    lines.push("|-------|---------|----------|--------|----------|");

    for (const stage of diagnostic.stageAnalysis) {
      const delta = `${stage.deltaPercent > 0 ? "+" : ""}${stage.deltaPercent.toFixed(1)}%`;
      lines.push(
        `| ${stage.stageName} | ${formatNumber(stage.currentValue)} | ${formatNumber(stage.previousValue)} | ${delta} | ${SEVERITY_EMOJI[stage.severity]} ${SEVERITY_LABEL[stage.severity]} |`,
      );
    }
    lines.push("");
  }

  // Drop-offs
  if (options.includeDropoffs !== false && diagnostic.dropoffs.length > 0) {
    lines.push("## Funnel Drop-offs");
    lines.push("");
    lines.push("| From | To | Current Rate | Previous Rate | Change |");
    lines.push("|------|----|-------------|---------------|--------|");

    for (const dropoff of diagnostic.dropoffs) {
      lines.push(
        `| ${dropoff.fromStage} | ${dropoff.toStage} | ${(dropoff.currentRate * 100).toFixed(2)}% | ${(dropoff.previousRate * 100).toFixed(2)}% | ${dropoff.deltaPercent > 0 ? "+" : ""}${dropoff.deltaPercent.toFixed(1)}% |`,
      );
    }
    lines.push("");
  }

  // Bottleneck
  if (diagnostic.bottleneck) {
    lines.push("## Bottleneck");
    lines.push("");
    lines.push(
      `The primary bottleneck is **${diagnostic.bottleneck.stageName}** (${diagnostic.bottleneck.metric}), ` +
        `which changed ${diagnostic.bottleneck.deltaPercent > 0 ? "+" : ""}${diagnostic.bottleneck.deltaPercent.toFixed(1)}% week-over-week.`,
    );
    lines.push("");
  }

  // Economic impact
  if (diagnostic.elasticity) {
    lines.push("## Economic Impact");
    lines.push("");
    lines.push(
      `**Total Estimated Revenue Impact:** $${diagnostic.elasticity.totalEstimatedRevenueLoss.toFixed(2)}`,
    );
    lines.push("");
    if (diagnostic.elasticity.impactRanking.length > 0) {
      lines.push("| Stage | Revenue Delta | Severity |");
      lines.push("|-------|--------------|----------|");
      for (const item of diagnostic.elasticity.impactRanking) {
        lines.push(
          `| ${item.stage} | $${item.estimatedRevenueDelta.toFixed(2)} | ${SEVERITY_EMOJI[item.severity]} |`,
        );
      }
      lines.push("");
    }
  }

  // Recommendations
  if (options.recommendations && options.recommendations.proposals.length > 0) {
    lines.push("## Recommended Actions");
    lines.push("");

    for (let i = 0; i < options.recommendations.proposals.length; i++) {
      const proposal = options.recommendations.proposals[i]!;
      lines.push(`### ${i + 1}. ${proposal.rationale.split(" — ")[0]}`);
      lines.push("");
      lines.push(`- **Confidence:** ${(proposal.confidence * 100).toFixed(0)}%`);
      lines.push(`- **Risk:** ${proposal.riskLevel}`);
      lines.push(`- **Expected Impact:** ${proposal.expectedImpact}`);
      lines.push(`- **Rationale:** ${proposal.rationale}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push(`*Report generated by Switchboard*`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML Report
// ---------------------------------------------------------------------------

function generateHTML(
  diagnostic: DiagnosticResult,
  options: ReportOptions,
  title: string,
  generatedAt: string,
  counts: Record<Severity, number>,
): string {
  const dateStr = new Date(generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const findingsHTML = generateFindingsHTML(diagnostic.findings);
  const stageHTML =
    options.includeStageAnalysis !== false ? generateStageTableHTML(diagnostic.stageAnalysis) : "";
  const dropoffHTML =
    options.includeDropoffs !== false ? generateDropoffTableHTML(diagnostic.dropoffs) : "";
  const bottleneckHTML = diagnostic.bottleneck ? generateBottleneckHTML(diagnostic.bottleneck) : "";
  const elasticityHTML = diagnostic.elasticity ? generateElasticityHTML(diagnostic.elasticity) : "";
  const recommendationsHTML = options.recommendations
    ? generateRecommendationsHTML(options.recommendations)
    : "";

  const spendDelta =
    diagnostic.spend.previous > 0
      ? (
          ((diagnostic.spend.current - diagnostic.spend.previous) / diagnostic.spend.previous) *
          100
        ).toFixed(1)
      : "N/A";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin: 24px 0 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 16px 0 8px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 20px; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 16px 0; }
  .summary-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  .summary-card .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-card .value { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; color: white; }
  .badge-critical { background: ${SEVERITY_COLOR.critical}; }
  .badge-warning { background: ${SEVERITY_COLOR.warning}; }
  .badge-info { background: ${SEVERITY_COLOR.info}; }
  .badge-healthy { background: ${SEVERITY_COLOR.healthy}; }
  .finding { border-left: 4px solid; padding: 12px 16px; margin: 8px 0; background: #f9fafb; border-radius: 0 6px 6px 0; }
  .finding-critical { border-color: ${SEVERITY_COLOR.critical}; }
  .finding-warning { border-color: ${SEVERITY_COLOR.warning}; }
  .finding-info { border-color: ${SEVERITY_COLOR.info}; }
  .finding-healthy { border-color: ${SEVERITY_COLOR.healthy}; }
  .finding .stage { font-weight: 600; font-size: 14px; }
  .finding .message { margin: 4px 0; font-size: 14px; }
  .finding .recommendation { font-size: 13px; color: #374151; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e5e7eb; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th { background: #f3f4f6; font-weight: 600; text-align: left; padding: 8px 12px; border-bottom: 2px solid #d1d5db; }
  td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
  tr:hover { background: #f9fafb; }
  .delta-positive { color: ${SEVERITY_COLOR.healthy}; }
  .delta-negative { color: ${SEVERITY_COLOR.critical}; }
  .proposal { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .proposal .confidence { font-size: 13px; color: #1d4ed8; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
</style>
</head>
<body>
<h1>${escapeHTML(title)}</h1>
<div class="meta">
  ${dateStr} &middot; ${escapeHTML(diagnostic.platform ?? "Unknown")} &middot; ${escapeHTML(diagnostic.vertical)} &middot; ${escapeHTML(diagnostic.entityId)}<br>
  Period: ${escapeHTML(diagnostic.periods.current.since)} to ${escapeHTML(diagnostic.periods.current.until)}
</div>

<h2>Executive Summary</h2>
<div class="summary-grid">
  <div class="summary-card">
    <div class="label">Current Spend</div>
    <div class="value">$${diagnostic.spend.current.toFixed(2)}</div>
  </div>
  <div class="summary-card">
    <div class="label">Spend Change</div>
    <div class="value ${Number(spendDelta) >= 0 ? "delta-positive" : "delta-negative"}">${spendDelta}%</div>
  </div>
  <div class="summary-card">
    <div class="label">${escapeHTML(diagnostic.primaryKPI.name)}</div>
    <div class="value">${diagnostic.primaryKPI.current.toFixed(2)}</div>
  </div>
  <div class="summary-card">
    <div class="label">KPI Change</div>
    <div class="value ${diagnostic.primaryKPI.deltaPercent >= 0 ? "delta-positive" : "delta-negative"}">${diagnostic.primaryKPI.deltaPercent > 0 ? "+" : ""}${diagnostic.primaryKPI.deltaPercent.toFixed(1)}%</div>
  </div>
</div>

<div style="margin: 16px 0;">
  ${counts.critical > 0 ? `<span class="badge badge-critical">${counts.critical} Critical</span> ` : ""}
  ${counts.warning > 0 ? `<span class="badge badge-warning">${counts.warning} Warning</span> ` : ""}
  ${counts.info > 0 ? `<span class="badge badge-info">${counts.info} Info</span> ` : ""}
  ${counts.healthy > 0 ? `<span class="badge badge-healthy">${counts.healthy} Healthy</span>` : ""}
</div>

${findingsHTML}
${stageHTML}
${dropoffHTML}
${bottleneckHTML}
${elasticityHTML}
${recommendationsHTML}

<div class="footer">Report generated by Switchboard</div>
</body>
</html>`;
}

function generateFindingsHTML(findings: Finding[]): string {
  if (findings.length === 0) return "";

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const items = sorted
    .map(
      (f) => `
  <div class="finding finding-${f.severity}">
    <div><span class="badge badge-${f.severity}">${SEVERITY_LABEL[f.severity]}</span> <span class="stage">${escapeHTML(f.stage)}</span></div>
    <div class="message">${escapeHTML(f.message)}</div>
    ${f.recommendation ? `<div class="recommendation"><strong>Recommendation:</strong> ${escapeHTML(f.recommendation)}</div>` : ""}
  </div>`,
    )
    .join("");

  return `<h2>Findings</h2>${items}`;
}

function generateStageTableHTML(stages: StageDiagnostic[]): string {
  if (stages.length === 0) return "";

  const rows = stages
    .map((s) => {
      const deltaClass = s.deltaPercent >= 0 ? "delta-positive" : "delta-negative";
      return `<tr>
    <td>${escapeHTML(s.stageName)}</td>
    <td>${formatNumber(s.currentValue)}</td>
    <td>${formatNumber(s.previousValue)}</td>
    <td class="${deltaClass}">${s.deltaPercent > 0 ? "+" : ""}${s.deltaPercent.toFixed(1)}%</td>
    <td><span class="badge badge-${s.severity}">${SEVERITY_LABEL[s.severity]}</span></td>
  </tr>`;
    })
    .join("");

  return `<h2>Stage Analysis</h2>
<table>
  <thead><tr><th>Stage</th><th>Current</th><th>Previous</th><th>Change</th><th>Severity</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function generateDropoffTableHTML(dropoffs: FunnelDropoff[]): string {
  if (dropoffs.length === 0) return "";

  const rows = dropoffs
    .map((d) => {
      const deltaClass = d.deltaPercent >= 0 ? "delta-positive" : "delta-negative";
      return `<tr>
    <td>${escapeHTML(d.fromStage)}</td>
    <td>${escapeHTML(d.toStage)}</td>
    <td>${(d.currentRate * 100).toFixed(2)}%</td>
    <td>${(d.previousRate * 100).toFixed(2)}%</td>
    <td class="${deltaClass}">${d.deltaPercent > 0 ? "+" : ""}${d.deltaPercent.toFixed(1)}%</td>
  </tr>`;
    })
    .join("");

  return `<h2>Funnel Drop-offs</h2>
<table>
  <thead><tr><th>From</th><th>To</th><th>Current Rate</th><th>Previous Rate</th><th>Change</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function generateBottleneckHTML(bottleneck: StageDiagnostic): string {
  return `<h2>Bottleneck</h2>
<p>The primary bottleneck is <strong>${escapeHTML(bottleneck.stageName)}</strong> (${escapeHTML(bottleneck.metric)}), which changed <span class="${bottleneck.deltaPercent >= 0 ? "delta-positive" : "delta-negative"}">${bottleneck.deltaPercent > 0 ? "+" : ""}${bottleneck.deltaPercent.toFixed(1)}%</span> week-over-week.</p>`;
}

function generateElasticityHTML(elasticity: {
  totalEstimatedRevenueLoss: number;
  impactRanking: Array<{
    stage: string;
    estimatedRevenueDelta: number;
    severity: Severity;
  }>;
}): string {
  const rows = elasticity.impactRanking
    .map(
      (item) => `<tr>
    <td>${escapeHTML(item.stage)}</td>
    <td>$${item.estimatedRevenueDelta.toFixed(2)}</td>
    <td><span class="badge badge-${item.severity}">${SEVERITY_LABEL[item.severity]}</span></td>
  </tr>`,
    )
    .join("");

  return `<h2>Economic Impact</h2>
<p><strong>Total Estimated Revenue Impact:</strong> $${elasticity.totalEstimatedRevenueLoss.toFixed(2)}</p>
${rows ? `<table><thead><tr><th>Stage</th><th>Revenue Delta</th><th>Severity</th></tr></thead><tbody>${rows}</tbody></table>` : ""}`;
}

function generateRecommendationsHTML(recommendations: RecommendationResult): string {
  if (recommendations.proposals.length === 0) return "";

  const items = recommendations.proposals
    .map(
      (p, i) => `
  <div class="proposal">
    <h3>${i + 1}. ${escapeHTML(p.rationale.split(" \u2014 ")[0] ?? p.rationale)}</h3>
    <div class="confidence">Confidence: ${(p.confidence * 100).toFixed(0)}% &middot; Risk: ${escapeHTML(p.riskLevel)}</div>
    <p style="margin-top:8px"><strong>Expected Impact:</strong> ${escapeHTML(p.expectedImpact)}</p>
    <p style="margin-top:4px; font-size:13px; color:#4b5563">${escapeHTML(p.rationale)}</p>
  </div>`,
    )
    .join("");

  return `<h2>Recommended Actions</h2>${items}`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
