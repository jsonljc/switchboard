import type { MultiPlatformResult, PlatformResult, PortfolioAction } from "./types.js";

// ---------------------------------------------------------------------------
// Executive Summary Generator
// ---------------------------------------------------------------------------
// Produces a plain-language summary from structured multi-platform results.
// ---------------------------------------------------------------------------

export function generateExecutiveSummary(
  platforms: PlatformResult[],
  crossPlatformFindings: MultiPlatformResult["crossPlatformFindings"],
  budgetRecommendations: MultiPlatformResult["budgetRecommendations"],
  portfolioActions?: PortfolioAction[]
): string {
  const lines: string[] = [];
  lines.push("## Multi-Platform Diagnostic Summary");
  lines.push("");

  // Platform overview
  const successful = platforms.filter((p) => p.status === "success");
  const failed = platforms.filter((p) => p.status === "error");

  lines.push(
    `Analyzed ${successful.length} platform${successful.length !== 1 ? "s" : ""}${failed.length > 0 ? ` (${failed.length} failed)` : ""}.`
  );
  lines.push("");

  // Per-platform summary
  for (const pr of platforms) {
    if (pr.status === "error") {
      lines.push(`### ${pr.platform.toUpperCase()} — Error`);
      lines.push(pr.error ?? "Unknown error");
      lines.push("");
      continue;
    }

    if (!pr.result) continue;

    const r = pr.result;
    const kpi = r.primaryKPI;
    const severityTag = `[${kpi.severity.toUpperCase()}]`;
    const direction = kpi.deltaPercent > 0 ? "+" : "";

    lines.push(`### ${pr.platform.toUpperCase()} — ${severityTag}`);
    lines.push(
      `${kpi.name}: $${kpi.current.toFixed(2)} (${direction}${kpi.deltaPercent.toFixed(1)}% WoW)`
    );
    lines.push(
      `Spend: $${r.spend.current.toFixed(2)} (prev: $${r.spend.previous.toFixed(2)})`
    );

    // Bottleneck
    if (r.bottleneck) {
      lines.push(
        `Bottleneck: ${r.bottleneck.stageName} (${r.bottleneck.deltaPercent.toFixed(1)}% drop)`
      );
    }

    // Critical/warning findings count
    const criticalCount = r.findings.filter(
      (f) => f.severity === "critical"
    ).length;
    const warningCount = r.findings.filter(
      (f) => f.severity === "warning"
    ).length;
    if (criticalCount > 0 || warningCount > 0) {
      const parts: string[] = [];
      if (criticalCount > 0) parts.push(`${criticalCount} critical`);
      if (warningCount > 0) parts.push(`${warningCount} warning`);
      lines.push(`Findings: ${parts.join(", ")}`);
    }

    lines.push("");
  }

  // Cross-platform findings
  if (crossPlatformFindings.length > 0) {
    lines.push("### Cross-Platform Insights");
    for (const finding of crossPlatformFindings) {
      const tag = `[${finding.severity.toUpperCase()}]`;
      lines.push(`${tag} ${finding.message}`);
      lines.push(`  → ${finding.recommendation}`);
      lines.push("");
    }
  }

  // Budget recommendations
  if (budgetRecommendations.length > 0) {
    lines.push("### Budget Recommendations");
    for (const rec of budgetRecommendations) {
      const confidence = `[${rec.confidence}]`;
      const shift = rec.suggestedShiftPercent
        ? ` (shift ~${rec.suggestedShiftPercent}%)`
        : "";
      lines.push(
        `${confidence} Consider shifting budget from ${rec.from} → ${rec.to}${shift}: ${rec.reason}`
      );
    }
    lines.push("");
  }

  // Portfolio actions
  if (portfolioActions && portfolioActions.length > 0) {
    lines.push("### Portfolio Actions (Ranked)");
    for (const action of portfolioActions) {
      const risk = `[${action.riskLevel.toUpperCase()} RISK]`;
      const confidence = `${(action.confidenceScore * 100).toFixed(0)}% confidence`;
      const revenue = action.estimatedRevenueRecovery > 0
        ? ` — est. $${action.estimatedRevenueRecovery.toFixed(0)} recovery`
        : "";
      lines.push(
        `${action.priority}. ${risk} ${action.action} (${confidence}${revenue})`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
