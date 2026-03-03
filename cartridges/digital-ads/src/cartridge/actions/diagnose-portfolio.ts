// ---------------------------------------------------------------------------
// Action: digital-ads.portfolio.diagnose
// ---------------------------------------------------------------------------
// Runs diagnostics across all configured platforms in parallel and produces
// cross-platform insights, budget recommendations, and an executive summary.
//
// Unlike the engine's runMultiPlatformDiagnostic(), this uses the cartridge's
// provider layer for client creation, enabling mock providers in tests.
// ---------------------------------------------------------------------------

import type { AdPlatformProvider } from "../providers/provider.js";
import type {
  DiagnosePortfolioParams,
  ExecuteResult,
  SessionState,
  PartialFailure,
} from "../types.js";
import type { EntityLevel } from "../../core/types.js";
import type { PlatformResult } from "../../orchestrator/types.js";
import { analyzeFunnel } from "../../core/analysis/funnel-walker.js";
import { buildComparisonPeriods } from "../../core/analysis/comparator.js";
import { buildDiagnosticContext } from "../../core/analysis/context-builder.js";
import { resolveFunnel, resolveBenchmarks } from "../../platforms/registry.js";
import { resolveAdvisors } from "../../advisors/registry.js";
import { correlate } from "../../orchestrator/correlator.js";
import { generateExecutiveSummary } from "../../orchestrator/summary.js";
import { generatePortfolioActions } from "../../orchestrator/portfolio-actions.js";
import { getYesterday } from "../utils.js";

export async function executeDiagnosePortfolio(
  params: DiagnosePortfolioParams,
  providers: Map<string, AdPlatformProvider>,
  _session: SessionState,
): Promise<ExecuteResult> {
  const start = Date.now();

  try {
    const refDate = params.referenceDate ? new Date(params.referenceDate) : getYesterday();
    const periodDays = params.periodDays ?? 7;
    const periods = buildComparisonPeriods(refDate, periodDays);

    // Run per-platform diagnostics using providers
    const tasks = params.platforms.map(async (platformConfig): Promise<PlatformResult> => {
      try {
        const provider = providers.get(platformConfig.platform);
        if (!provider) {
          return {
            platform: platformConfig.platform,
            status: "error",
            error: `No provider registered for platform: ${platformConfig.platform}`,
          };
        }

        const client = provider.createClient(platformConfig.credentials);
        const entityLevel: EntityLevel = platformConfig.entityLevel ?? "account";

        const funnel = resolveFunnel(platformConfig.platform, params.vertical, {
          qualifiedLeadActionType: platformConfig.qualifiedLeadActionType,
        });
        const benchmarks = resolveBenchmarks(platformConfig.platform, params.vertical, {
          qualifiedLeadActionType: platformConfig.qualifiedLeadActionType,
        });
        const advisors = resolveAdvisors(platformConfig.platform, params.vertical);

        const { current, previous } = await client.fetchComparisonSnapshots(
          platformConfig.entityId,
          entityLevel,
          periods.current,
          periods.previous,
          funnel,
        );

        const context = await buildDiagnosticContext({
          client,
          entityId: platformConfig.entityId,
          entityLevel,
          funnel,
          referenceDate: refDate,
          periodDays,
          enableHistorical: platformConfig.enableHistoricalTrends ?? false,
          historicalPeriods: 4,
          enableStructural: platformConfig.enableStructuralAnalysis ?? false,
          currentSnapshot: current,
          previousSnapshot: previous,
        });

        const result = analyzeFunnel({
          funnel,
          current,
          previous,
          periods,
          benchmarks,
          advisors,
          context,
        });
        result.platform = platformConfig.platform;

        return {
          platform: platformConfig.platform,
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

    const settled = await Promise.allSettled(tasks);
    const platformResults: PlatformResult[] = settled.map((s, index) => {
      if (s.status === "fulfilled") return s.value;
      return {
        platform: params.platforms[index]!.platform,
        status: "error" as const,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    });

    // Correlate across platforms
    const { findings: crossPlatformFindings, budgetRecommendations } = correlate(platformResults);

    // Generate portfolio actions
    const portfolioActions = generatePortfolioActions(
      platformResults,
      crossPlatformFindings,
      budgetRecommendations,
    );

    // Generate executive summary
    const executiveSummary = generateExecutiveSummary(
      platformResults,
      crossPlatformFindings,
      budgetRecommendations,
      portfolioActions,
    );

    const multiResult = {
      platforms: platformResults,
      crossPlatformFindings,
      budgetRecommendations,
      executiveSummary,
      portfolioActions,
    };

    // Collect partial failures
    const partialFailures: PartialFailure[] = platformResults
      .filter((p) => p.status === "error")
      .map((p) => ({
        step: `${p.platform}_fetch`,
        error: p.error ?? "Unknown error",
      }));

    const successCount = platformResults.filter((p) => p.status === "success").length;
    const errorCount = platformResults.filter((p) => p.status === "error").length;
    const totalFindings = crossPlatformFindings.length;

    return {
      success: successCount > 0,
      summary: `Portfolio diagnostic "${params.name}": ${successCount} platforms succeeded, ${errorCount} failed. ${totalFindings} cross-platform findings. ${budgetRecommendations.length} budget recommendations.`,
      externalRefs: {
        name: params.name,
        vertical: params.vertical,
        platforms: params.platforms.map((p) => p.platform).join(", "),
      },
      rollbackAvailable: false,
      partialFailures,
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: multiResult,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Portfolio diagnostic failed: ${errorMsg}`,
      externalRefs: {
        name: params.name,
        vertical: params.vertical,
      },
      rollbackAvailable: false,
      partialFailures: [{ step: "portfolio_diagnose", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
