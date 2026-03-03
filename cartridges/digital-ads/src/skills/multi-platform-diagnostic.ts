import type { MultiPlatformResult } from "../orchestrator/types.js";
import { formatDiagnostic } from "./funnel-diagnostic.js";

// ---------------------------------------------------------------------------
// Skill: Multi-Platform Diagnostic
// ---------------------------------------------------------------------------
// Entry point for the multi-platform orchestrator. Takes an AccountConfig
// and runs diagnostics across all enabled platforms, then correlates results.
// ---------------------------------------------------------------------------

export { runMultiPlatformDiagnostic } from "../orchestrator/runner.js";

/**
 * Format a MultiPlatformResult into a human-readable string for agent output.
 */
export function formatMultiPlatformDiagnostic(result: MultiPlatformResult): string {
  const lines: string[] = [];

  // Executive summary first
  lines.push(result.executiveSummary);
  lines.push("");

  // Portfolio actions (if available)
  if (result.portfolioActions && result.portfolioActions.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Portfolio Actions");
    for (const action of result.portfolioActions) {
      const risk = `[${action.riskLevel.toUpperCase()} RISK]`;
      const confidence = `${(action.confidenceScore * 100).toFixed(0)}%`;
      const revenue =
        action.estimatedRevenueRecovery > 0
          ? ` | est. $${action.estimatedRevenueRecovery.toFixed(0)} recovery`
          : "";
      lines.push(
        `${action.priority}. ${risk} ${action.action} (${confidence} confidence${revenue})`,
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Detailed per-platform reports
  for (const pr of result.platforms) {
    if (pr.status === "error") {
      lines.push(`## ${pr.platform.toUpperCase()} — Error`);
      lines.push(pr.error ?? "Unknown error");
      lines.push("");
      continue;
    }

    if (pr.result) {
      lines.push(formatDiagnostic(pr.result));
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}
