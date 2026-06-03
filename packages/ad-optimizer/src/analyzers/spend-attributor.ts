import type {
  CampaignInsightSchema as CampaignInsight,
  AdSetLearningInput,
} from "@switchboard/schemas";
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";

/**
 * Map an ad-set `destinationType` to a per-source funnel key
 * (`ctwa` | `instant_form`). Returns null for sources not currently surfaced
 * by the per-source funnel (e.g. plain WEBSITE) so spend isn't double-counted.
 */
export function destinationTypeToSource(destinationType: string | undefined): string | null {
  if (!destinationType) return null;
  if (destinationType === "ON_AD") return "instant_form";
  if (destinationType === "WHATSAPP" || destinationType.includes("WHATSAPP")) return "ctwa";
  return null;
}

// "Fully attributed" tolerance: 1 cent absolute or 0.5% relative — absorbs
// float-precision noise without masking genuine partial coverage.
function isFullyAttributed(attributed: number, total: number): boolean {
  if (total <= 0) return attributed <= 0.01;
  const diff = Math.abs(total - attributed);
  return diff <= 0.01 || diff / total <= 0.005;
}

/**
 * Per-source fraction of a source's spend that the source-reallocation decision requires to be
 * ad-set-attributed (vs the synthetic lead-share fallback) before that source's trueROAS is
 * trusted to move budget. A coverage threshold, not mere presence (#851 named this refinement).
 * Gated PER candidate source, not account-wide: an account-wide fraction can pass while one
 * candidate's spend is entirely lead-share (synthetic), which would let the comparison move
 * budget on a fabricated denominator. Conservative by construction: a campaign mixing a tracked
 * (CTWA / instant-form) ad set with an untracked (e.g. WEBSITE) one is NOT fully attributed, so
 * its whole spend is lead-share and contributes 0 to its sources' real numerators. 0.7 is tuned
 * against the currently-mapped destinations (ON_AD / WHATSAPP, see `destinationTypeToSource`);
 * revisit once a real account's `destination_type` distribution is observed. Eval-tunable —
 * never change silently.
 */
export const SPEND_ATTRIBUTION_COVERAGE_FLOOR = 0.7;

export interface SpendAttributionResult {
  /** Spend attributed to each source (real ad-set attribution where a campaign is fully
   * attributed; synthetic lead-share otherwise). */
  spendBySource: Record<string, number>;
  /** Per-source fraction of that source's spend that came from REAL ad-set destination
   * attribution (fully-attributed campaigns) vs the synthetic lead-share fallback —
   * `realSpend(s) / spendBySource(s)`, in [0,1]; 0 when the source has no spend. The
   * reallocation gate requires BOTH candidate sources to clear the floor. */
  coverageBySource: Record<string, number>;
}

/**
 * Compute spend attributed to each source. Strategy (Option B per Task 13 review):
 *   1. Tally matched ad-set spend per campaign by destination_type.
 *   2. A campaign is "fully attributed" only if matched-ad-set spend ≈ total
 *      campaign spend. Mixed campaigns fall back to lead-share for the FULL
 *      campaign spend (partial matches discarded).
 *   3. Unattributed campaigns: distribute spend in proportion to
 *      `bySource[s].received`. Zero lead totals → spend left unattributed.
 *
 * Tradeoff vs Option A: simpler bookkeeping at the cost of accuracy when a
 * campaign mixes a matched ad set with an unmatched one (e.g. WHATSAPP +
 * WEBSITE). Most campaigns are single-destination in practice; we optimise
 * for the common case and guarantee no silent spend loss.
 */
export function computeSpendBySource(
  insights: CampaignInsight[],
  bySource: Record<string, SourceFunnel>,
  adSetData: AdSetLearningInput[] | null,
): SpendAttributionResult {
  const sources = Object.keys(bySource);
  const spendBySource: Record<string, number> = Object.fromEntries(sources.map((s) => [s, 0]));
  // Per-source REAL (ad-set-attributed) spend — the lead-share fallback below never adds to it,
  // so coverageBySource = realSpendBySource / spendBySource distinguishes real from synthetic.
  const realSpendBySource: Record<string, number> = Object.fromEntries(sources.map((s) => [s, 0]));

  // Per-campaign tally of matched ad-set spend, partitioned by source.
  const matchedByCampaign = new Map<string, Record<string, number>>();
  if (adSetData) {
    for (const adSet of adSetData) {
      const source = destinationTypeToSource(adSet.destinationType);
      if (!source || !(source in spendBySource)) continue;
      const current = matchedByCampaign.get(adSet.campaignId) ?? {};
      current[source] = (current[source] ?? 0) + (adSet.spend ?? 0);
      matchedByCampaign.set(adSet.campaignId, current);
    }
  }

  // Campaigns whose matched-ad-set spend covers the full campaign spend.
  const campaignsFullyAttributed = new Set<string>();
  for (const insight of insights) {
    const matched = matchedByCampaign.get(insight.campaignId);
    if (!matched) continue;
    const totalMatched = Object.values(matched).reduce((a, b) => a + b, 0);
    if (isFullyAttributed(totalMatched, insight.spend)) {
      campaignsFullyAttributed.add(insight.campaignId);
      for (const [source, spend] of Object.entries(matched)) {
        spendBySource[source] = (spendBySource[source] ?? 0) + spend;
        realSpendBySource[source] = (realSpendBySource[source] ?? 0) + spend;
      }
    }
  }

  // Lead-share fallback for everything else (no ad-set data, or mixed).
  const totalLeadsBySource = sources.reduce(
    (acc, s) => {
      acc[s] = bySource[s]?.received ?? 0;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalLeads = Object.values(totalLeadsBySource).reduce((a, b) => a + b, 0);

  for (const insight of insights) {
    if (campaignsFullyAttributed.has(insight.campaignId)) continue;
    if (totalLeads <= 0) continue;
    for (const source of sources) {
      const share = (totalLeadsBySource[source] ?? 0) / totalLeads;
      spendBySource[source] = (spendBySource[source] ?? 0) + insight.spend * share;
    }
  }

  // Per-source coverage: the fraction of EACH source's spend that is real ad-set attribution
  // (fully-attributed campaigns) vs the synthetic lead-share fallback. Gated per candidate
  // source so an account-wide pass cannot bless a comparison whose other side is all fallback.
  const coverageBySource: Record<string, number> = {};
  for (const source of sources) {
    const total = spendBySource[source] ?? 0;
    coverageBySource[source] = total > 0 ? (realSpendBySource[source] ?? 0) / total : 0;
  }

  return { spendBySource, coverageBySource };
}
