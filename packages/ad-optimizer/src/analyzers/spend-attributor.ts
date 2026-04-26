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
): Record<string, number> {
  const sources = Object.keys(bySource);
  const spendBySource: Record<string, number> = Object.fromEntries(sources.map((s) => [s, 0]));

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

  return spendBySource;
}
