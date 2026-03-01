// ---------------------------------------------------------------------------
// Action: digital-ads.structure.analyze
// ---------------------------------------------------------------------------
// Analyzes ad account structure: fragmentation, budget skew, creative
// diversity, pacing, and overlap. Runs only structural advisors.
// ---------------------------------------------------------------------------

import type { AdPlatformProvider } from "../providers/provider.js";
import type {
  AnalyzeStructureParams,
  ExecuteResult,
  SessionState,
} from "../types.js";
import type { Finding, SubEntityBreakdown } from "../../core/types.js";
import { buildComparisonPeriods } from "../../core/analysis/comparator.js";
import { resolveFunnel } from "../../platforms/registry.js";
import {
  adsetFragmentationAdvisor,
  budgetSkewAdvisor,
  learningInstabilityAdvisor,
  budgetPacingAdvisor,
  creativeDiversityAdvisor,
} from "../../advisors/structural/index.js";
import { getYesterday } from "../utils.js";

export async function executeAnalyzeStructure(
  params: AnalyzeStructureParams,
  provider: AdPlatformProvider,
  session: SessionState,
  credentials?: import("../../platforms/types.js").PlatformCredentials
): Promise<ExecuteResult> {
  const start = Date.now();

  try {
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
    const { entityId, vertical, periodDays = 7 } = params;

    // Check if client supports sub-entity breakdowns
    if (typeof client.fetchSubEntityBreakdowns !== "function") {
      return {
        success: false,
        summary: `${params.platform} client does not support sub-entity breakdowns for structural analysis.`,
        externalRefs: { platform: params.platform, entityId },
        rollbackAvailable: false,
        partialFailures: [
          {
            step: "check_capability",
            error: "fetchSubEntityBreakdowns not supported",
          },
        ],
        durationMs: Date.now() - start,
        undoRecipe: null,
      };
    }

    const funnel = resolveFunnel(params.platform, vertical);
    const refDate = getYesterday();
    const periods = buildComparisonPeriods(refDate, periodDays);

    // Fetch comparison snapshots for structural advisors
    const { current, previous } = await client.fetchComparisonSnapshots(
      entityId,
      "account",
      periods.current,
      periods.previous,
      funnel
    );

    // Fetch sub-entity breakdowns (guard above ensures this exists)
    const subEntities: SubEntityBreakdown[] =
      await client.fetchSubEntityBreakdowns!(
        entityId,
        "account",
        periods.current,
        funnel
      );

    // Run structural advisors with sub-entity context
    const structuralAdvisors = [
      adsetFragmentationAdvisor,
      budgetSkewAdvisor,
      learningInstabilityAdvisor,
      budgetPacingAdvisor,
      creativeDiversityAdvisor,
    ];

    const findings: Finding[] = [];
    for (const advisor of structuralAdvisors) {
      findings.push(
        ...advisor(
          [], // stageAnalysis not needed for structural
          [], // dropoffs not needed for structural
          current,
          previous,
          { subEntities }
        )
      );
    }

    const criticalCount = findings.filter(
      (f) => f.severity === "critical"
    ).length;
    const warningCount = findings.filter(
      (f) => f.severity === "warning"
    ).length;

    return {
      success: true,
      summary: `Structural analysis for ${params.platform} ${entityId}: ${subEntities.length} sub-entities, ${criticalCount} critical, ${warningCount} warning findings.`,
      externalRefs: {
        platform: params.platform,
        entityId,
        period: `${periods.current.since} to ${periods.current.until}`,
      },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
      data: {
        subEntities,
        findings,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Structural analysis failed for ${params.platform} ${params.entityId}: ${errorMsg}`,
      externalRefs: {
        platform: params.platform,
        entityId: params.entityId,
      },
      rollbackAvailable: false,
      partialFailures: [{ step: "analyze_structure", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
