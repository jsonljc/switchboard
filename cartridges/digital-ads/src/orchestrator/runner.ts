import type { EntityLevel } from "../core/types.js";
import type { AccountConfig } from "../config/types.js";
import type { MultiPlatformResult, PlatformResult } from "./types.js";
import { analyzeFunnel } from "../core/analysis/funnel-walker.js";
import { buildComparisonPeriods } from "../core/analysis/comparator.js";
import { buildDiagnosticContext } from "../core/analysis/context-builder.js";
import {
  createPlatformClient,
  resolveFunnel,
  resolveBenchmarks,
} from "../platforms/registry.js";
import { resolveAdvisors } from "../advisors/registry.js";
import { correlate } from "./correlator.js";
import { generateExecutiveSummary } from "./summary.js";
import { generatePortfolioActions } from "./portfolio-actions.js";

// ---------------------------------------------------------------------------
// Multi-Platform Diagnostic Runner
// ---------------------------------------------------------------------------
// Runs diagnostics across all enabled platforms in parallel, then correlates
// the results to detect cross-platform patterns.
// ---------------------------------------------------------------------------

export async function runMultiPlatformDiagnostic(
  config: AccountConfig
): Promise<MultiPlatformResult> {
  const refDate = config.referenceDate
    ? new Date(config.referenceDate)
    : getYesterday();
  const periodDays = config.periodDays ?? 7;
  const periods = buildComparisonPeriods(refDate, periodDays);

  // Build per-platform tasks
  const tasks = config.platforms
    .filter((p) => p.enabled !== false)
    .map(async (platformConfig): Promise<PlatformResult> => {
      try {
        const platform = platformConfig.platform;
        const entityLevel: EntityLevel =
          platformConfig.entityLevel ?? "account";

        // Resolve platform-specific config
        const client = createPlatformClient(platformConfig.credentials);
        const funnel = resolveFunnel(platform, config.vertical, {
          qualifiedLeadActionType: platformConfig.qualifiedLeadActionType,
        });
        const benchmarks = resolveBenchmarks(platform, config.vertical, {
          qualifiedLeadActionType: platformConfig.qualifiedLeadActionType,
        });
        const advisors = resolveAdvisors(platform, config.vertical);

        // Fetch comparison data
        const { current, previous } =
          await client.fetchComparisonSnapshots(
            platformConfig.entityId,
            entityLevel,
            periods.current,
            periods.previous,
            funnel
          );

        // Build diagnostic context (historical trends, structural data, revenue)
        const context = await buildDiagnosticContext({
          client,
          entityId: platformConfig.entityId,
          entityLevel,
          funnel,
          referenceDate: refDate,
          periodDays,
          enableHistorical: platformConfig.enableHistoricalTrends ?? false,
          historicalPeriods: platformConfig.historicalPeriods ?? 4,
          enableStructural: platformConfig.enableStructuralAnalysis ?? false,
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

        return {
          platform,
          status: "success",
          result,
        };
      } catch (err) {
        return {
          platform: platformConfig.platform,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

  // Run all platforms in parallel — one failing doesn't block others
  const enabledPlatforms = config.platforms.filter((p) => p.enabled !== false);
  const settled = await Promise.allSettled(tasks);

  const platformResults: PlatformResult[] = settled.map((s, index) => {
    if (s.status === "fulfilled") {
      return s.value;
    }
    // This shouldn't happen since we catch inside the task, but handle it
    return {
      platform: enabledPlatforms[index]!.platform,
      status: "error" as const,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
    };
  });

  // Correlate across platforms
  const { findings: crossPlatformFindings, budgetRecommendations } =
    correlate(platformResults);

  // Generate portfolio actions
  const portfolioActions = generatePortfolioActions(
    platformResults,
    crossPlatformFindings,
    budgetRecommendations
  );

  // Generate executive summary
  const executiveSummary = generateExecutiveSummary(
    platformResults,
    crossPlatformFindings,
    budgetRecommendations,
    portfolioActions
  );

  return {
    platforms: platformResults,
    crossPlatformFindings,
    budgetRecommendations,
    executiveSummary,
    portfolioActions,
  };
}

function getYesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}
