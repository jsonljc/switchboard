// ---------------------------------------------------------------------------
// Action: digital-ads.funnel.diagnose
// ---------------------------------------------------------------------------
// Runs a complete single-platform funnel diagnostic. This is the primary
// action — it runs 14-24 advisors internally based on platform + vertical.
// ---------------------------------------------------------------------------

import type { AdPlatformProvider } from "../providers/provider.js";
import type {
  DiagnoseFunnelParams,
  ExecuteResult,
  SessionState,
} from "../types.js";
import type { DiagnosticResult } from "../../core/types.js";
import { analyzeFunnel } from "../../core/analysis/funnel-walker.js";
import { buildComparisonPeriods } from "../../core/analysis/comparator.js";
import { buildDiagnosticContext } from "../../core/analysis/context-builder.js";
import { resolveFunnel, resolveBenchmarks } from "../../platforms/registry.js";
import { resolveAdvisors } from "../../advisors/registry.js";
import { getYesterday } from "../utils.js";

export async function executeDiagnoseFunnel(
  params: DiagnoseFunnelParams,
  provider: AdPlatformProvider,
  session: SessionState,
  credentials?: import("../../platforms/types.js").PlatformCredentials
): Promise<ExecuteResult> {
  const start = Date.now();

  try {
    // Resolve credentials from session or params
    const creds =
      credentials ?? session.connections.get(params.platform)?.credentials;
    if (!creds) {
      return {
        success: false,
        summary: `No credentials available for ${params.platform}. Use platform.connect first.`,
        externalRefs: { platform: params.platform, entityId: params.entityId },
        rollbackAvailable: false,
        partialFailures: [
          { step: "resolve_credentials", error: "No credentials found" },
        ],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    const client = provider.createClient(creds);
    const {
      entityId,
      entityLevel = "account",
      vertical,
      periodDays = 7,
      referenceDate,
      enableStructuralAnalysis = false,
      enableHistoricalTrends = false,
    } = params;

    const funnel = resolveFunnel(params.platform, vertical);
    const benchmarks = resolveBenchmarks(params.platform, vertical);
    const advisors = resolveAdvisors(params.platform, vertical);

    const refDate = referenceDate ? new Date(referenceDate) : getYesterday();
    const periods = buildComparisonPeriods(refDate, periodDays);

    // Fetch data
    const { current, previous } = await client.fetchComparisonSnapshots(
      entityId,
      entityLevel,
      periods.current,
      periods.previous,
      funnel
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
      historicalPeriods: 4,
      enableStructural: enableStructuralAnalysis,
      currentSnapshot: current,
      previousSnapshot: previous,
    });

    // Analyze
    const result: DiagnosticResult = analyzeFunnel({
      funnel,
      current,
      previous,
      periods,
      benchmarks,
      advisors,
      context,
    });
    result.platform = params.platform;

    // Build summary
    const criticalCount = result.findings.filter(
      (f) => f.severity === "critical"
    ).length;
    const warningCount = result.findings.filter(
      (f) => f.severity === "warning"
    ).length;

    return {
      success: true,
      summary: `Diagnosed ${params.platform} ${vertical} account ${entityId}: ${criticalCount} critical, ${warningCount} warning findings. Period: ${periods.current.since} to ${periods.current.until}.`,
      externalRefs: {
        platform: params.platform,
        entityId,
        period: `${periods.current.since} to ${periods.current.until}`,
        vertical,
      },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: result,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Funnel diagnostic failed for ${params.platform} ${params.entityId}: ${errorMsg}`,
      externalRefs: {
        platform: params.platform,
        entityId: params.entityId,
      },
      rollbackAvailable: false,
      partialFailures: [{ step: "diagnose", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
