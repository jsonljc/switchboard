import { analyzeFunnel } from "../core/analysis/funnel-walker.js";
import { buildComparisonPeriods } from "../core/analysis/comparator.js";
import { buildDiagnosticContext } from "../core/analysis/context-builder.js";
import { createPlatformClient, resolveFunnel, resolveBenchmarks } from "../platforms/registry.js";
import { resolveAdvisors } from "../advisors/registry.js";
import type { DiagnosticResult, EntityLevel, Severity, VerticalType } from "../core/types.js";
import type { PlatformType, PlatformCredentials } from "../platforms/types.js";

// ---------------------------------------------------------------------------
// Skill: Funnel Diagnostic
// ---------------------------------------------------------------------------
// Entry point for the agent. Takes an ad account (or campaign/adset) and
// returns a complete funnel diagnostic with actionable findings.
//
// Supports all platforms via the platform registry. Defaults to Meta
// for backward compatibility.
// ---------------------------------------------------------------------------

export interface FunnelDiagnosticInput {
  /** e.g. "act_123456789" */
  entityId: string;
  entityLevel?: EntityLevel;
  accessToken: string;
  /** Defaults to "commerce" */
  vertical?: VerticalType;
  /** Platform to diagnose (default: "meta") */
  platform?: PlatformType;
  /** Number of days per comparison period (default 7 = WoW) */
  periodDays?: number;
  /** Reference date for "current" period end. Defaults to yesterday. */
  referenceDate?: string;
  /**
   * For leadgen vertical only: the Meta actions[] action_type that represents
   * a qualified lead. This is the event the advertiser sends back via
   * Conversions API when a lead passes their qualification criteria.
   *
   * Common values:
   *   - "offsite_conversion.fb_pixel_lead" (default)
   *   - "offsite_conversion.custom.qualified_lead"
   *   - "offsite_conversion.custom.<your_event_name>"
   *
   * Ignored for non-leadgen verticals.
   */
  qualifiedLeadActionType?: string;
  /** Enable historical trend analysis for creative exhaustion detection */
  enableHistoricalTrends?: boolean;
  /** Number of trailing periods for historical analysis (default: 4) */
  historicalPeriods?: number;
  /** Enable structural analysis (sub-entity breakdowns) */
  enableStructuralAnalysis?: boolean;
}

export async function runFunnelDiagnostic(input: FunnelDiagnosticInput): Promise<DiagnosticResult> {
  const {
    entityId,
    entityLevel = "account",
    accessToken,
    vertical = "commerce",
    platform = "meta",
    periodDays = 7,
    referenceDate,
    qualifiedLeadActionType,
    enableHistoricalTrends = false,
    historicalPeriods = 4,
    enableStructuralAnalysis = false,
  } = input;

  // Resolve platform config via registry
  const credentials = buildCredentials(platform, accessToken);
  const client = createPlatformClient(credentials);
  const funnel = resolveFunnel(platform, vertical, { qualifiedLeadActionType });
  const benchmarks = resolveBenchmarks(platform, vertical, {
    qualifiedLeadActionType,
  });
  const advisors = resolveAdvisors(platform, vertical);

  // Build time periods
  const refDate = referenceDate ? new Date(referenceDate) : getYesterday();
  const periods = buildComparisonPeriods(refDate, periodDays);

  // Fetch data
  const { current, previous } = await client.fetchComparisonSnapshots(
    entityId,
    entityLevel,
    periods.current,
    periods.previous,
    funnel,
  );

  // Build diagnostic context
  const context = await buildDiagnosticContext({
    client,
    entityId,
    entityLevel,
    funnel,
    referenceDate: refDate,
    periodDays,
    enableHistorical: enableHistoricalTrends,
    historicalPeriods,
    enableStructural: enableStructuralAnalysis,
    currentSnapshot: current,
    previousSnapshot: previous,
  });

  // Analyze
  const result = analyzeFunnel({
    funnel,
    current,
    previous,
    periods,
    benchmarks,
    advisors,
    context,
  });

  // Tag with platform
  result.platform = platform;

  return result;
}

/**
 * Format a DiagnosticResult into a human-readable string for agent output.
 */
export function formatDiagnostic(result: DiagnosticResult): string {
  const lines: string[] = [];

  // Header
  const platformTag = result.platform ? ` (${result.platform.toUpperCase()})` : "";
  lines.push(`## Funnel Diagnostic: ${result.entityId}${platformTag}`);
  lines.push(
    `Period: ${result.periods.current.since} to ${result.periods.current.until} vs ${result.periods.previous.since} to ${result.periods.previous.until}`,
  );
  lines.push(
    `Spend: $${result.spend.current.toFixed(2)} (prev: $${result.spend.previous.toFixed(2)})`,
  );
  lines.push("");

  // Primary KPI
  const kpi = result.primaryKPI;
  const kpiIcon = severityIcon(kpi.severity);
  lines.push(`### Primary KPI: ${kpi.name} ${kpiIcon}`);
  lines.push(
    `$${kpi.current.toFixed(2)} → was $${kpi.previous.toFixed(2)} (${kpi.deltaPercent > 0 ? "+" : ""}${kpi.deltaPercent.toFixed(1)}% WoW)`,
  );
  lines.push("");

  // Funnel overview
  lines.push("### Funnel Stage Volumes (WoW)");
  for (const stage of result.stageAnalysis) {
    const icon = stage.isSignificant ? severityIcon(stage.severity) : "";
    lines.push(
      `- ${stage.stageName}: ${stage.currentValue.toLocaleString()} (${stage.deltaPercent > 0 ? "+" : ""}${stage.deltaPercent.toFixed(1)}%) ${icon}`,
    );
  }
  lines.push("");

  // Drop-off rates
  lines.push("### Stage Conversion Rates");
  for (const dropoff of result.dropoffs) {
    const change = dropoff.deltaPercent;
    const flag = change < -20 ? " ⚠" : "";
    lines.push(
      `- ${dropoff.fromStage} → ${dropoff.toStage}: ${(dropoff.currentRate * 100).toFixed(2)}% (was ${(dropoff.previousRate * 100).toFixed(2)}%)${flag}`,
    );
  }
  lines.push("");

  // Bottleneck
  if (result.bottleneck) {
    lines.push(
      `### Bottleneck: ${result.bottleneck.stageName} (${result.bottleneck.deltaPercent.toFixed(1)}% drop)`,
    );
    lines.push("");
  }

  // Economic Impact
  if (result.elasticity && result.elasticity.impactRanking.length > 0) {
    lines.push("### Economic Impact");
    lines.push(
      `Estimated total revenue loss: $${Math.abs(result.elasticity.totalEstimatedRevenueLoss).toFixed(0)}/period`,
    );
    for (const entry of result.elasticity.impactRanking) {
      const icon = severityIcon(entry.severity);
      lines.push(`- ${entry.stage}: $${Math.abs(entry.estimatedRevenueDelta).toFixed(0)} ${icon}`);
    }
    lines.push("");
  }

  // Findings
  if (result.findings.length > 0) {
    lines.push("### Findings");
    for (const finding of result.findings) {
      const icon = severityIcon(finding.severity);
      lines.push(`${icon} **[${finding.stage}]** ${finding.message}`);
      if (finding.recommendation) {
        lines.push(`  → ${finding.recommendation}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build minimal credentials from accessToken + platform.
 * For Meta and TikTok, accessToken is sufficient for the basic case.
 * For Google, the full credentials should be provided via the config system.
 */
function buildCredentials(platform: PlatformType, accessToken: string): PlatformCredentials {
  switch (platform) {
    case "meta":
      return { platform: "meta", accessToken };
    case "tiktok":
      return { platform: "tiktok", accessToken, appId: "" };
    case "google":
      throw new Error(
        "Google Ads requires full OAuth2 credentials. Use the multi-platform diagnostic skill with an AccountConfig instead.",
      );
  }
}

function getYesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

function severityIcon(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "[CRITICAL]";
    case "warning":
      return "[WARNING]";
    case "info":
      return "[INFO]";
    case "healthy":
      return "[OK]";
  }
}
