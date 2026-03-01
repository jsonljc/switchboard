import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Creative Diversity Advisor
// ---------------------------------------------------------------------------
// Detects portfolio risk from insufficient creative diversity within ad sets.
// Fewer than 3 active ads per ad set means fatigue will hit faster.
// Single-ad dominance (>80% of ad set spend) is a portfolio risk.
//
// Data: AdBreakdown[] from DiagnosticContext (populated by platform clients
// when ad-level breakdowns are enabled).
// ---------------------------------------------------------------------------

export const creativeDiversityAdvisor: FindingAdvisor = (
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
  const adSetMap = new Map<string, typeof ads>();
  for (const ad of ads) {
    const existing = adSetMap.get(ad.adSetId) ?? [];
    existing.push(ad);
    adSetMap.set(ad.adSetId, existing);
  }

  let thinPortfolioCount = 0;
  let dominanceCount = 0;
  const formatSet = new Set<string>();

  for (const [_adSetId, adSetAds] of adSetMap) {
    const activeAds = adSetAds.filter((a) => a.spend > 0);

    // Track format diversity
    for (const ad of activeAds) {
      if (ad.format) formatSet.add(ad.format);
    }

    // Flag 1: Fewer than 3 active ads per ad set
    if (activeAds.length < 3 && activeAds.length > 0) {
      thinPortfolioCount++;
    }

    // Flag 2: Single ad dominates >80% of ad set spend
    if (activeAds.length >= 2) {
      const adSetSpend = activeAds.reduce((sum, a) => sum + a.spend, 0);
      if (adSetSpend > 0) {
        const topAd = activeAds.reduce((max, a) => (a.spend > max.spend ? a : max));
        const topAdShare = topAd.spend / adSetSpend;

        if (topAdShare > 0.8) {
          dominanceCount++;
        }
      }
    }
  }

  const totalAdSets = adSetMap.size;

  // Creative thin portfolio warning
  if (thinPortfolioCount > 0 && totalAdSets > 0) {
    const pct = ((thinPortfolioCount / totalAdSets) * 100).toFixed(0);
    findings.push({
      severity: thinPortfolioCount > totalAdSets * 0.5 ? "warning" : "info",
      stage: "creative_diversity",
      message: `${thinPortfolioCount} of ${totalAdSets} ad sets (${pct}%) have fewer than 3 active ads. Thin creative portfolios fatigue faster and give the algorithm fewer options to optimize.`,
      recommendation:
        "Add at least 3-5 active ads per ad set. Vary the creative angle, format (image vs. video vs. carousel), and hook. This gives the algorithm more options and extends creative longevity.",
    });
  }

  // Single-ad dominance warning
  if (dominanceCount > 0 && totalAdSets > 0) {
    const pct = ((dominanceCount / totalAdSets) * 100).toFixed(0);
    findings.push({
      severity: dominanceCount > totalAdSets * 0.5 ? "warning" : "info",
      stage: "creative_diversity",
      message: `${dominanceCount} of ${totalAdSets} ad sets (${pct}%) have a single ad consuming >80% of spend. This creates single-point-of-failure risk if that ad fatigues.`,
      recommendation:
        "When one ad dominates spend, the algorithm has decided it's the best performer — but this creates fragility. Add 2-3 new creative variations to diversify. If the dominant ad is truly superior, the new ads will get tested at low spend with minimal risk.",
    });
  }

  // Format diversity check across all ad sets
  if (formatSet.size === 1 && ads.length >= 5) {
    const onlyFormat = [...formatSet][0];
    findings.push({
      severity: "info",
      stage: "creative_diversity",
      message: `All ${ads.length} active ads use the same format (${onlyFormat}). Lack of format diversity limits the algorithm's ability to match creative to user preferences.`,
      recommendation:
        "Test multiple creative formats: static images, videos, carousels, and collection ads. Different users engage with different formats — video drives awareness while carousel can improve consideration. Platform algorithms perform best with format diversity.",
    });
  }

  return findings;
};
