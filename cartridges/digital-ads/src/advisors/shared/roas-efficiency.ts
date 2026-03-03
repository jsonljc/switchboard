import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";
import { percentChange } from "../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// ROAS Efficiency Advisor
// ---------------------------------------------------------------------------
// ROAS is the primary KPI for most commerce advertisers. The engine fetches
// ROAS data (website_purchase_roas on Meta, computed on Google/TikTok) and
// stores it in topLevel — but no advisor previously read it.
//
// This advisor:
// 1. Trends ROAS WoW; flags declining ROAS even when CPA looks stable
//    (AOV may be dropping)
// 2. Compares actual vs target ROAS (user-provided targetROAS config)
// 3. Detects ROAS ↔ CPA divergence (ROAS down but CPA stable = AOV issue)
// ---------------------------------------------------------------------------

/**
 * Extract the best available ROAS value from a snapshot's topLevel data.
 * Checks platform-specific keys: roas_offsite_conversion.fb_pixel_purchase (Meta),
 * roas (Google/TikTok), and falls back to computing from revenue/spend.
 */
function extractROAS(snapshot: MetricSnapshot): number | null {
  const tl = snapshot.topLevel;

  // Meta stores ROAS under roas_<action_type> keys
  for (const key of Object.keys(tl)) {
    if (key.startsWith("roas_") && tl[key]! > 0) {
      return tl[key]!;
    }
  }

  // Google/TikTok store as plain "roas"
  if (tl.roas && tl.roas > 0) return tl.roas;

  // Fallback: compute from revenue / spend
  const revenue = tl.conversions_value ?? tl.complete_payment_value ?? tl.purchase_value ?? 0;
  const spend = snapshot.spend;
  if (spend > 0 && revenue > 0) return revenue / spend;

  return null;
}

export interface ROASEfficiencyOptions {
  /** Target ROAS — when set, the advisor flags actuals below target */
  targetROAS?: number;
}

export function createROASEfficiencyAdvisor(options?: ROASEfficiencyOptions): FindingAdvisor {
  return (
    _stageAnalysis: StageDiagnostic[],
    _dropoffs: FunnelDropoff[],
    current: MetricSnapshot,
    previous: MetricSnapshot,
    _context?: DiagnosticContext,
  ): Finding[] => {
    const findings: Finding[] = [];

    const currentROAS = extractROAS(current);
    const previousROAS = extractROAS(previous);

    // Need ROAS data in at least one period to be useful
    if (currentROAS === null && previousROAS === null) return findings;

    // 1. ROAS trend WoW
    if (currentROAS !== null && previousROAS !== null && previousROAS > 0) {
      const roasChange = percentChange(currentROAS, previousROAS);

      if (roasChange < -15) {
        // Check if CPA is also worsening, or if this is an AOV-driven issue
        const currentCPA =
          current.topLevel.cost_per_conversion ??
          current.topLevel.cost_per_complete_payment ??
          null;
        const previousCPA =
          previous.topLevel.cost_per_conversion ??
          previous.topLevel.cost_per_complete_payment ??
          null;

        let cpaChange: number | null = null;
        if (currentCPA !== null && previousCPA !== null && previousCPA > 0) {
          cpaChange = percentChange(currentCPA, previousCPA);
        }

        const isAOVIssue = cpaChange !== null && Math.abs(cpaChange) < 10;
        const severity = roasChange < -30 ? ("critical" as const) : ("warning" as const);

        findings.push({
          severity,
          stage: "roas",
          message: isAOVIssue
            ? `ROAS declined ${roasChange.toFixed(1)}% WoW (${previousROAS.toFixed(2)}x → ${currentROAS.toFixed(2)}x) while CPA remained relatively stable. This suggests average order value is dropping rather than acquisition cost increasing.`
            : `ROAS declined ${roasChange.toFixed(1)}% WoW (${previousROAS.toFixed(2)}x → ${currentROAS.toFixed(2)}x).`,
          recommendation: isAOVIssue
            ? "Investigate product mix shifts — are lower-priced products getting more traffic? Check if promotional discounts are eroding order value. Consider value-based bidding to prioritize higher-value customers."
            : "Review bid strategy and audience targeting. If using target ROAS bidding, the algorithm may need a lower target to maintain delivery. Check if high-value customer segments are being reached.",
        });
      } else if (roasChange > 20) {
        findings.push({
          severity: "healthy",
          stage: "roas",
          message: `ROAS improved ${roasChange.toFixed(1)}% WoW (${previousROAS.toFixed(2)}x → ${currentROAS.toFixed(2)}x).`,
          recommendation: null,
        });
      }
    }

    // 2. Target ROAS comparison
    if (options?.targetROAS && currentROAS !== null) {
      const target = options.targetROAS;
      if (currentROAS < target) {
        const shortfall = ((target - currentROAS) / target) * 100;
        const severity = shortfall > 30 ? ("critical" as const) : ("warning" as const);

        findings.push({
          severity,
          stage: "roas",
          message: `Current ROAS (${currentROAS.toFixed(2)}x) is ${shortfall.toFixed(1)}% below target (${target.toFixed(2)}x).`,
          recommendation:
            shortfall > 30
              ? "ROAS is significantly below target. Consider reducing spend on underperforming campaigns, tightening audience targeting, or switching to a target ROAS bid strategy if not already using one."
              : "ROAS is slightly below target. Monitor closely and consider incremental bid/audience adjustments. Small creative refreshes can sometimes improve conversion rates enough to close the gap.",
        });
      }
    }

    return findings;
  };
}

/** Default ROAS efficiency advisor (no target ROAS) */
export const roasEfficiencyAdvisor: FindingAdvisor = createROASEfficiencyAdvisor();
