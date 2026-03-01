/**
 * Formats diagnostic results from the digital-ads cartridge into
 * human-readable chat messages.
 */

const DIAGNOSTIC_ACTION_TYPES = new Set([
  "digital-ads.funnel.diagnose",
  "digital-ads.portfolio.diagnose",
  "digital-ads.snapshot.fetch",
  "digital-ads.structure.analyze",
]);

export function isDiagnosticAction(actionType: string): boolean {
  return DIAGNOSTIC_ACTION_TYPES.has(actionType);
}

export function formatDiagnosticResult(actionType: string, data: unknown): string {
  if (!data || typeof data !== "object") {
    return "Diagnostic completed but returned no data.";
  }

  switch (actionType) {
    case "digital-ads.funnel.diagnose":
      return formatFunnelDiagnostic(data as FunnelData);
    case "digital-ads.portfolio.diagnose":
      return formatPortfolioDiagnostic(data as PortfolioData);
    case "digital-ads.snapshot.fetch":
      return formatSnapshot(data as SnapshotData);
    case "digital-ads.structure.analyze":
      return formatStructureAnalysis(data as StructureData);
    default:
      return "Diagnostic completed.";
  }
}

// ---------------------------------------------------------------------------
// Local type aliases (keep loose — data comes from cartridge via unknown)
// ---------------------------------------------------------------------------

interface FunnelData {
  vertical?: string;
  platform?: string;
  periods?: {
    current?: { since?: string; until?: string };
    previous?: { since?: string; until?: string };
  };
  primaryKPI?: {
    name?: string;
    current?: number;
    previous?: number;
    deltaPercent?: number;
    severity?: string;
  };
  stageAnalysis?: Array<{
    stageName?: string;
    currentValue?: number;
    previousValue?: number;
    deltaPercent?: number;
    severity?: string;
  }>;
  bottleneck?: {
    stageName?: string;
    deltaPercent?: number;
  } | null;
  findings?: Array<{
    severity?: string;
    message?: string;
    recommendation?: string | null;
  }>;
  elasticity?: {
    totalEstimatedRevenueLoss?: number;
  } | null;
}

interface PortfolioData {
  platforms?: Array<{
    platform?: string;
    status?: string;
    result?: FunnelData;
    error?: string;
  }>;
  crossPlatformFindings?: Array<{
    severity?: string;
    message?: string;
    recommendation?: string;
  }>;
  budgetRecommendations?: Array<{
    from?: string;
    to?: string;
    reason?: string;
    suggestedShiftPercent?: number;
  }>;
  executiveSummary?: string;
}

interface SnapshotData {
  entityId?: string;
  entityLevel?: string;
  periodStart?: string;
  periodEnd?: string;
  spend?: number;
  stages?: Record<string, { count?: number; cost?: number | null }>;
  topLevel?: Record<string, number>;
}

interface StructureData {
  subEntities?: Array<{
    entityId?: string;
    entityLevel?: string;
    spend?: number;
    conversions?: number;
    daysSinceLastEdit?: number | null;
    inLearningPhase?: boolean;
    dailyBudget?: number | null;
  }>;
  findings?: Array<{
    severity?: string;
    message?: string;
    recommendation?: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | undefined): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function pct(value: number | undefined): string {
  if (value === undefined || value === null) return "N/A";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function num(value: number | undefined): string {
  if (value === undefined || value === null) return "N/A";
  return value.toLocaleString("en-US");
}

function dollars(value: number | undefined): string {
  if (value === undefined || value === null) return "N/A";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function severityTag(severity: string | undefined): string {
  switch (severity?.toLowerCase()) {
    case "critical":
      return " [CRITICAL]";
    case "warning":
      return " [WARNING]";
    case "info":
      return " [INFO]";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Funnel Diagnostic
// ---------------------------------------------------------------------------

function formatFunnelDiagnostic(data: FunnelData): string {
  const lines: string[] = [];

  const vertical = data.vertical ?? "unknown";
  const platform = data.platform ?? "meta";
  lines.push(`Funnel Diagnostic — ${capitalize(platform)} ${capitalize(vertical)}`);

  if (data.periods?.current && data.periods?.previous) {
    const cur = data.periods.current;
    const prev = data.periods.previous;
    lines.push(
      `Period: ${formatDate(cur.since)} – ${formatDate(cur.until)} vs ${formatDate(prev.since)} – ${formatDate(prev.until)}`,
    );
  }

  lines.push("");

  // Primary KPI
  if (data.primaryKPI) {
    const kpi = data.primaryKPI;
    lines.push(`Primary KPI: ${kpi.name ?? "unknown"}`);
    lines.push(
      `  Current: ${num(kpi.current)} | Previous: ${num(kpi.previous)} | Change: ${pct(kpi.deltaPercent)}${severityTag(kpi.severity)}`,
    );
    lines.push("");
  }

  // Stage analysis
  if (data.stageAnalysis && data.stageAnalysis.length > 0) {
    lines.push("Stage Analysis:");
    for (const stage of data.stageAnalysis) {
      const name = (stage.stageName ?? "?").padEnd(16);
      lines.push(
        `  ${name} ${num(stage.previousValue).padStart(10)} → ${num(stage.currentValue).padStart(10)}  (${pct(stage.deltaPercent)})${severityTag(stage.severity)}`,
      );
    }
    lines.push("");
  }

  // Bottleneck
  if (data.bottleneck) {
    lines.push(
      `Bottleneck: ${data.bottleneck.stageName ?? "?"} (${pct(data.bottleneck.deltaPercent)})`,
    );
    lines.push("");
  }

  // Findings
  if (data.findings && data.findings.length > 0) {
    lines.push("Key Findings:");
    for (const f of data.findings) {
      const tag = f.severity ? `[${f.severity.toUpperCase()}]` : "";
      lines.push(`  ${tag} ${f.message ?? ""}`);
      if (f.recommendation) {
        lines.push(`    → ${f.recommendation}`);
      }
    }
    lines.push("");
  }

  // Estimated revenue impact
  if (data.elasticity?.totalEstimatedRevenueLoss !== undefined) {
    lines.push(
      `Estimated Revenue Impact: ${dollars(data.elasticity.totalEstimatedRevenueLoss)}`,
    );
    lines.push("");
  }

  lines.push('Reply "pause [campaign]" or "adjust budget" to take action.');

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Portfolio Diagnostic
// ---------------------------------------------------------------------------

function formatPortfolioDiagnostic(data: PortfolioData): string {
  const lines: string[] = [];

  lines.push("Portfolio Diagnostic Report");
  lines.push("");

  // Executive summary
  if (data.executiveSummary) {
    lines.push(data.executiveSummary);
    lines.push("");
  }

  // Per-platform summaries
  if (data.platforms && data.platforms.length > 0) {
    lines.push("Platform Summaries:");
    for (const p of data.platforms) {
      const platform = capitalize(p.platform ?? "unknown");
      if (p.status === "error") {
        lines.push(`  ${platform}: Error — ${p.error ?? "unknown error"}`);
      } else if (p.result?.primaryKPI) {
        const kpi = p.result.primaryKPI;
        lines.push(
          `  ${platform}: ${kpi.name ?? "KPI"} ${num(kpi.current)} (${pct(kpi.deltaPercent)})${severityTag(kpi.severity)}`,
        );
      } else {
        lines.push(`  ${platform}: No data`);
      }
    }
    lines.push("");
  }

  // Cross-platform findings
  if (data.crossPlatformFindings && data.crossPlatformFindings.length > 0) {
    lines.push("Cross-Platform Findings:");
    for (const f of data.crossPlatformFindings) {
      const tag = f.severity ? `[${f.severity.toUpperCase()}]` : "";
      lines.push(`  ${tag} ${f.message ?? ""}`);
      if (f.recommendation) {
        lines.push(`    → ${f.recommendation}`);
      }
    }
    lines.push("");
  }

  // Budget recommendations
  if (data.budgetRecommendations && data.budgetRecommendations.length > 0) {
    lines.push("Budget Recommendations:");
    for (const br of data.budgetRecommendations) {
      const shift = br.suggestedShiftPercent
        ? ` (${br.suggestedShiftPercent}%)`
        : "";
      lines.push(
        `  ${capitalize(br.from ?? "?")} → ${capitalize(br.to ?? "?")}${shift}: ${br.reason ?? ""}`,
      );
    }
    lines.push("");
  }

  lines.push('Reply "adjust budget" or "pause [campaign]" to take action.');

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function formatSnapshot(data: SnapshotData): string {
  const lines: string[] = [];

  lines.push("Metrics Snapshot");

  if (data.entityId) {
    lines.push(`Entity: ${data.entityId} (${data.entityLevel ?? "account"})`);
  }
  if (data.periodStart || data.periodEnd) {
    lines.push(`Period: ${formatDate(data.periodStart)} – ${formatDate(data.periodEnd)}`);
  }

  lines.push("");

  if (data.spend !== undefined) {
    lines.push(`Spend: ${dollars(data.spend)}`);
  }

  // Top-level metrics
  if (data.topLevel && Object.keys(data.topLevel).length > 0) {
    lines.push("");
    lines.push("Top-Level Metrics:");
    for (const [key, value] of Object.entries(data.topLevel)) {
      const label = key.toUpperCase().padEnd(12);
      const formatted = key.includes("ctr") || key.includes("rate")
        ? `${(value * 100).toFixed(2)}%`
        : key.includes("cpm") || key.includes("cpc") || key.includes("cpa") || key.includes("roas")
          ? dollars(value)
          : num(value);
      lines.push(`  ${label} ${formatted}`);
    }
  }

  // Stage metrics
  if (data.stages && Object.keys(data.stages).length > 0) {
    lines.push("");
    lines.push("Funnel Stages:");
    for (const [stage, metrics] of Object.entries(data.stages)) {
      const count = num(metrics?.count);
      const cost = metrics?.cost !== null && metrics?.cost !== undefined
        ? ` (cost: ${dollars(metrics.cost)})`
        : "";
      lines.push(`  ${stage.padEnd(16)} ${count}${cost}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Structure Analysis
// ---------------------------------------------------------------------------

function formatStructureAnalysis(data: StructureData): string {
  const lines: string[] = [];

  lines.push("Campaign Structure Analysis");
  lines.push("");

  // Sub-entity breakdown
  if (data.subEntities && data.subEntities.length > 0) {
    lines.push("Sub-Entities:");
    for (const e of data.subEntities) {
      const id = (e.entityId ?? "?").padEnd(20);
      const level = (e.entityLevel ?? "?").padEnd(10);
      const flags: string[] = [];
      if (e.inLearningPhase) flags.push("LEARNING");
      if (e.daysSinceLastEdit !== null && e.daysSinceLastEdit !== undefined) {
        flags.push(`edited ${e.daysSinceLastEdit}d ago`);
      }
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      lines.push(
        `  ${id} ${level} spend: ${dollars(e.spend)}  conv: ${num(e.conversions)}  budget: ${e.dailyBudget !== null && e.dailyBudget !== undefined ? dollars(e.dailyBudget) : "N/A"}${flagStr}`,
      );
    }
    lines.push("");
  }

  // Findings
  if (data.findings && data.findings.length > 0) {
    lines.push("Structural Findings:");
    for (const f of data.findings) {
      const tag = f.severity ? `[${f.severity.toUpperCase()}]` : "";
      lines.push(`  ${tag} ${f.message ?? ""}`);
      if (f.recommendation) {
        lines.push(`    → ${f.recommendation}`);
      }
    }
    lines.push("");
  }

  if (!data.subEntities?.length && !data.findings?.length) {
    lines.push("No structural issues detected.");
  }

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
