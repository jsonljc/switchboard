import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";
import { percentChange } from "../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// Auction Competition Advisor (universal — works across all platforms)
// ---------------------------------------------------------------------------
// When CPM rises significantly, it's an auction-level issue —
// more advertisers competing for the same audience.
//
// The recommendation varies by vertical (commerce vs. leadgen).
// ---------------------------------------------------------------------------

export interface AuctionCompetitionOptions {
  /** Override recommendation text */
  recommendation?: string;
}

export function createAuctionCompetitionAdvisor(
  options?: AuctionCompetitionOptions
): FindingAdvisor {
  const defaultRecommendation =
    "Check if this coincides with a seasonal competition spike (BFCM, Q4, etc). Consider broadening audience targeting to access cheaper inventory. If using interest-based targeting, the audience may be oversaturated.";

  return (
    _stageAnalysis: StageDiagnostic[],
    _dropoffs: FunnelDropoff[],
    current: MetricSnapshot,
    previous: MetricSnapshot
  ): Finding[] => {
    const findings: Finding[] = [];
    const currentCPM = current.topLevel.cpm ?? 0;
    const previousCPM = previous.topLevel.cpm ?? 0;

    if (previousCPM === 0) return findings;

    const cpmChange = percentChange(currentCPM, previousCPM);

    if (cpmChange > 25) {
      findings.push({
        severity: cpmChange > 50 ? "critical" : "warning",
        stage: "awareness",
        message: `CPMs increased ${cpmChange.toFixed(1)}% ($${previousCPM.toFixed(2)} → $${currentCPM.toFixed(2)}). This inflates costs at every downstream stage even if conversion rates hold.`,
        recommendation: options?.recommendation ?? defaultRecommendation,
      });
    }

    return findings;
  };
}

/** Default auction competition advisor (commerce-style recommendation) */
export const auctionCompetitionAdvisor: FindingAdvisor =
  createAuctionCompetitionAdvisor();

/** Leadgen-specific auction competition advisor */
export const leadgenAuctionCompetitionAdvisor: FindingAdvisor =
  createAuctionCompetitionAdvisor({
    recommendation:
      "Leadgen audiences (especially B2B) tend to be narrow, making them sensitive to auction pressure. Consider broadening your audience, or shifting budget to lower-competition placements (Reels, Stories). Check if the spike coincides with seasonal advertiser surges.",
  });
