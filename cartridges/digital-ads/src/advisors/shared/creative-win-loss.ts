import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
  AdBreakdown,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Creative Win/Loss Advisor
// ---------------------------------------------------------------------------
// Ranks ads by CPA within each ad set, identifies statistical winners
// and underperformers, and recommends pausing losers / scaling winners.
//
// A "winner" is an ad with CPA significantly below the ad set average.
// A "loser" is an ad with CPA significantly above the ad set average
// that is still consuming meaningful spend.
//
// This builds on the AdBreakdown data from Wave 2's creative diversity
// infrastructure.
//
// Data: AdBreakdown[] from DiagnosticContext.
// ---------------------------------------------------------------------------

/** Minimum spend share for an ad to be considered meaningful */
const MIN_SPEND_SHARE = 0.05; // 5% of ad set spend

/** CPA ratio thresholds relative to ad set average */
const WINNER_RATIO = 0.6; // CPA < 60% of average = winner
const LOSER_RATIO = 2.0; // CPA > 200% of average = loser
const UNDERPERFORMER_RATIO = 1.5; // CPA > 150% of average = underperformer

/** Minimum conversions for statistical reliability */
const MIN_CONVERSIONS_FOR_JUDGMENT = 3;

interface AdPerformance {
  ad: AdBreakdown;
  cpa: number;
  spendShare: number;
  classification: "winner" | "loser" | "underperformer" | "neutral";
}

export const creativeWinLossAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext
): Finding[] => {
  if (!context?.adBreakdowns || context.adBreakdowns.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  const ads = context.adBreakdowns;

  // Group ads by ad set
  const adSetMap = new Map<string, AdBreakdown[]>();
  for (const ad of ads) {
    const existing = adSetMap.get(ad.adSetId) ?? [];
    existing.push(ad);
    adSetMap.set(ad.adSetId, existing);
  }

  let totalWinners = 0;
  let totalLosers = 0;
  let totalLoserSpend = 0;
  let totalAccountSpend = 0;
  const topWinners: AdPerformance[] = [];
  const topLosers: AdPerformance[] = [];

  for (const [_adSetId, adSetAds] of adSetMap) {
    const activeAds = adSetAds.filter((a) => a.spend > 0);
    if (activeAds.length < 2) continue;

    const adSetSpend = activeAds.reduce((sum, a) => sum + a.spend, 0);
    const adSetConversions = activeAds.reduce((sum, a) => sum + a.conversions, 0);
    totalAccountSpend += adSetSpend;

    if (adSetSpend === 0 || adSetConversions === 0) continue;

    const avgCPA = adSetSpend / adSetConversions;

    // Classify each ad
    for (const ad of activeAds) {
      const spendShare = ad.spend / adSetSpend;
      if (spendShare < MIN_SPEND_SHARE) continue;

      let classification: AdPerformance["classification"] = "neutral";

      if (ad.conversions >= MIN_CONVERSIONS_FOR_JUDGMENT) {
        const adCPA = ad.spend / ad.conversions;
        const ratio = adCPA / avgCPA;

        if (ratio <= WINNER_RATIO) {
          classification = "winner";
          totalWinners++;
          topWinners.push({ ad, cpa: adCPA, spendShare, classification });
        } else if (ratio >= LOSER_RATIO) {
          classification = "loser";
          totalLosers++;
          totalLoserSpend += ad.spend;
          topLosers.push({ ad, cpa: adCPA, spendShare, classification });
        } else if (ratio >= UNDERPERFORMER_RATIO) {
          classification = "underperformer";
          totalLosers++;
          totalLoserSpend += ad.spend;
          topLosers.push({ ad, cpa: adCPA, spendShare, classification });
        }
      } else if (ad.conversions === 0 && spendShare > 0.1) {
        // Significant spend with zero conversions = loser
        classification = "loser";
        totalLosers++;
        totalLoserSpend += ad.spend;
        topLosers.push({
          ad,
          cpa: Infinity,
          spendShare,
          classification,
        });
      }
    }
  }

  // Sort winners by CPA (lowest first), losers by spend (highest first)
  topWinners.sort((a, b) => a.cpa - b.cpa);
  topLosers.sort((a, b) => b.ad.spend - a.ad.spend);

  // Report losers/underperformers
  if (totalLosers > 0 && totalAccountSpend > 0) {
    const wastedPercent = (totalLoserSpend / totalAccountSpend) * 100;
    const loserList = topLosers
      .slice(0, 3)
      .map((l) =>
        l.cpa === Infinity
          ? `${l.ad.adId} ($${l.ad.spend.toFixed(2)} spend, 0 conversions)`
          : `${l.ad.adId} (CPA $${l.cpa.toFixed(2)}, ${(l.spendShare * 100).toFixed(0)}% of ad set spend)`
      )
      .join("; ");

    findings.push({
      severity: wastedPercent > 20 ? "critical" : "warning",
      stage: "creative_win_loss",
      message: `${totalLosers} underperforming ad(s) consuming $${totalLoserSpend.toFixed(2)} (${wastedPercent.toFixed(1)}% of spend) with CPA significantly above ad set averages. Top underperformers: ${loserList}.`,
      recommendation:
        "Pause the worst-performing ads to immediately reduce wasted spend. The algorithm will redistribute budget to better-performing ads within each ad set. Monitor CPA for 2-3 days after pausing to confirm improvement.",
    });
  }

  // Report winners
  if (topWinners.length > 0) {
    const winnerList = topWinners
      .slice(0, 3)
      .map(
        (w) =>
          `${w.ad.adId} (CPA $${w.cpa.toFixed(2)}, ${(w.spendShare * 100).toFixed(0)}% spend share)`
      )
      .join("; ");

    findings.push({
      severity: "info",
      stage: "creative_win_loss",
      message: `${totalWinners} top-performing ad(s) identified with CPA well below average. Winners: ${winnerList}.`,
      recommendation:
        "Scale winners by increasing budget on their parent ad sets or duplicating winning ad creative into new ad sets with fresh audiences. Analyze what makes winners work (hook, format, offer) and apply those learnings to new creative.",
    });
  }

  return findings;
};
