import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Audience Overlap Advisor (Meta-focused)
// ---------------------------------------------------------------------------
// Detects audience overlap between ad sets by analyzing spend and CPA
// patterns. When multiple ad sets target overlapping audiences, they
// compete against each other in the auction, driving up CPMs and
// reducing overall efficiency.
//
// Overlap detection heuristics (no API call needed):
// 1. Multiple ad sets with similar CPMs + declining efficiency = likely
//    overlap (they're bidding against each other).
// 2. High ad set count with correlated CPA increases = audience
//    fragmentation causing self-competition.
//
// Data: SubEntityBreakdown[] from DiagnosticContext.
// Optional: AudienceOverlapData[] from context.audienceOverlaps
// (when Meta's delivery estimate API data is available).
// ---------------------------------------------------------------------------

/** Audience overlap data point between two ad sets */
export interface AudienceOverlapPair {
  adSetId1: string;
  adSetId2: string;
  /** Overlap percentage (0-1) */
  overlapRate: number;
}

export const audienceOverlapAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext
): Finding[] => {
  const findings: Finding[] = [];

  if (!context?.subEntities || context.subEntities.length < 2) {
    return findings;
  }

  const entities = context.subEntities;

  // Check for explicit overlap data if available
  if (context.audienceOverlaps && context.audienceOverlaps.length > 0) {
    return analyzeExplicitOverlap(context.audienceOverlaps, entities.length);
  }

  // Heuristic overlap detection from structural signals
  return analyzeHeuristicOverlap(entities, current);
};

// ---------------------------------------------------------------------------
// Explicit overlap analysis (when API data is available)
// ---------------------------------------------------------------------------

function analyzeExplicitOverlap(
  overlaps: AudienceOverlapPair[],
  _totalAdSets: number
): Finding[] {
  const findings: Finding[] = [];

  const highOverlaps = overlaps.filter((o) => o.overlapRate > 0.3);
  const criticalOverlaps = overlaps.filter((o) => o.overlapRate > 0.5);

  if (criticalOverlaps.length > 0) {
    const pairDescriptions = criticalOverlaps
      .slice(0, 3) // Show max 3 pairs
      .map(
        (o) =>
          `${o.adSetId1} ↔ ${o.adSetId2} (${(o.overlapRate * 100).toFixed(0)}%)`
      )
      .join(", ");

    findings.push({
      severity: "critical",
      stage: "audience_overlap",
      message: `Critical audience overlap detected: ${criticalOverlaps.length} ad set pair(s) share >50% of their audience. Top pairs: ${pairDescriptions}. These ad sets are competing against each other in the auction, inflating CPMs.`,
      recommendation:
        "Consolidate heavily overlapping ad sets into a single ad set with broader targeting. Alternatively, use audience exclusions to create non-overlapping segments. On Meta, use the Audience Overlap tool in Ads Manager to verify and act on overlaps.",
    });
    return findings;
  }

  if (highOverlaps.length > 0) {
    const affectedPairs = highOverlaps.length;
    const avgOverlap =
      highOverlaps.reduce((sum, o) => sum + o.overlapRate, 0) / affectedPairs;

    findings.push({
      severity: "warning",
      stage: "audience_overlap",
      message: `Audience overlap detected: ${affectedPairs} ad set pair(s) share >30% of their audience (avg ${(avgOverlap * 100).toFixed(0)}% overlap). Self-competition in the auction is likely increasing CPMs.`,
      recommendation:
        "Use audience exclusions between overlapping ad sets to reduce self-competition. On Meta, go to Audiences → select the audiences → Compare Overlap to identify the most impactful consolidation opportunities.",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Heuristic overlap detection (when API data is not available)
// ---------------------------------------------------------------------------

function analyzeHeuristicOverlap(
  entities: NonNullable<DiagnosticContext["subEntities"]>,
  current: MetricSnapshot
): Finding[] {
  const findings: Finding[] = [];
  const activeEntities = entities.filter((e) => e.spend > 0);

  if (activeEntities.length < 3) return findings;

  const totalSpend = activeEntities.reduce((sum, e) => sum + e.spend, 0);
  const totalConversions = activeEntities.reduce(
    (sum, e) => sum + e.conversions,
    0
  );

  if (totalSpend === 0 || totalConversions === 0) return findings;

  // Compute per-ad-set CPA
  const cpas = activeEntities
    .filter((e) => e.conversions > 0)
    .map((e) => e.spend / e.conversions);

  if (cpas.length < 2) return findings;

  // Heuristic 1: High ad set count (>5) + rising CPM + similar CPAs
  // When many ad sets have similar CPAs, they're likely targeting similar
  // audiences — unique targeting would produce diverse CPAs
  const avgCPA = totalSpend / totalConversions;
  const cpaVariance =
    cpas.reduce((sum, cpa) => sum + Math.pow(cpa - avgCPA, 2), 0) / cpas.length;
  const cpaCV = Math.sqrt(cpaVariance) / avgCPA; // Coefficient of variation

  const currentCPM = current.topLevel.cpm ?? 0;

  // Low CPA variation (<0.3 CV) with many ad sets = likely overlap
  if (activeEntities.length >= 5 && cpaCV < 0.3 && currentCPM > 0) {
    findings.push({
      severity: "warning",
      stage: "audience_overlap",
      message: `Possible audience overlap: ${activeEntities.length} active ad sets show very similar CPAs (CV=${(cpaCV * 100).toFixed(0)}%), suggesting they may be targeting the same audience pool. This can cause self-competition and inflate CPMs.`,
      recommendation:
        "When multiple ad sets have similar CPAs, they're likely competing for the same users. Use Meta's Audience Overlap tool to verify, then consolidate overlapping ad sets or add audience exclusions. Consider using broad targeting with fewer ad sets to let the algorithm optimize delivery.",
    });
  }

  // Heuristic 2: Many zero-conversion ad sets while others convert well
  // Overlap causes auction loss for weaker ad sets
  const zeroConvEntities = activeEntities.filter(
    (e) => e.conversions === 0 && e.spend > totalSpend * 0.03
  );
  const convertingEntities = activeEntities.filter((e) => e.conversions > 0);

  if (
    zeroConvEntities.length >= 2 &&
    convertingEntities.length >= 2 &&
    zeroConvEntities.length >= activeEntities.length * 0.3
  ) {
    findings.push({
      severity: "info",
      stage: "audience_overlap",
      message: `${zeroConvEntities.length} of ${activeEntities.length} ad sets have spend but zero conversions, while ${convertingEntities.length} ad sets are converting. This pattern can indicate audience overlap where weaker ad sets lose auctions to stronger ones.`,
      recommendation:
        "Pause or consolidate zero-conversion ad sets. If they share targeting with converting ad sets, they're likely losing auctions to those ad sets. Check for overlapping interests, lookalike percentages, or custom audience overlap.",
    });
  }

  return findings;
}
