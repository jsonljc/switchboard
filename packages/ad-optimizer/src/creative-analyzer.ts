// packages/ad-optimizer/src/creative-analyzer.ts
import type {
  CreativeEntrySchema,
  CreativeDiagnosisSchema,
  CreativeAnalysisSchema,
} from "@switchboard/schemas";

type CreativeEntry = CreativeEntrySchema;
type CreativeDiagnosis = CreativeDiagnosisSchema;
type CreativeAnalysis = CreativeAnalysisSchema;

export interface RawAdData {
  adId: string;
  imageHash: string | null;
  videoId: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
  videoViews: number | null;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
  conversionRateRanking: string | null;
}

/**
 * Deduplicate raw ad data by creative asset (video_id or image_hash).
 * Groups ads sharing the same creative, aggregates metrics, and calculates
 * thumbStopRatio for video creatives.
 */
export function deduplicateCreatives(rawAds: RawAdData[]): CreativeEntry[] {
  const totalSpend = rawAds.reduce((sum, ad) => sum + ad.spend, 0);

  const groups = new Map<string, { keyType: "image_hash" | "video_id"; ads: RawAdData[] }>();

  for (const ad of rawAds) {
    const key = ad.videoId ?? ad.imageHash ?? ad.adId;
    const keyType: "image_hash" | "video_id" = ad.videoId ? "video_id" : "image_hash";

    const existing = groups.get(key);
    if (existing) {
      existing.ads.push(ad);
    } else {
      groups.set(key, { keyType, ads: [ad] });
    }
  }

  const entries: CreativeEntry[] = [];

  for (const [creativeKey, { keyType, ads }] of groups) {
    const spend = ads.reduce((s, a) => s + a.spend, 0);
    const impressions = ads.reduce((s, a) => s + a.impressions, 0);
    const clicks = ads.reduce((s, a) => s + a.clicks, 0);
    const conversions = ads.reduce((s, a) => s + a.conversions, 0);

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;

    // Weighted average ROAS by spend
    const weightedRoas = spend > 0 ? ads.reduce((sum, a) => sum + a.roas * a.spend, 0) / spend : 0;

    // thumbStopRatio: only if any ad has videoViews
    const hasVideoViews = ads.some((a) => a.videoViews !== null);
    let thumbStopRatio: number | null = null;
    if (hasVideoViews) {
      const totalVideoViews = ads.reduce((s, a) => s + (a.videoViews ?? 0), 0);
      thumbStopRatio = impressions > 0 ? (totalVideoViews / impressions) * 100 : 0;
    }

    const first = ads[0] as RawAdData;

    entries.push({
      creativeKey,
      keyType,
      adIds: ads.map((a) => a.adId),
      spend,
      spendShare: totalSpend > 0 ? spend / totalSpend : 0,
      impressions,
      clicks,
      ctr,
      cpc,
      cpa,
      roas: weightedRoas,
      conversions,
      thumbStopRatio,
      qualityRanking: first.qualityRanking,
      engagementRateRanking: first.engagementRateRanking,
      conversionRateRanking: first.conversionRateRanking,
    });
  }

  return entries;
}

/**
 * Analyze creative entries for a campaign and produce diagnoses.
 * Detects spend concentration and underperforming outliers.
 */
export function analyzeCreatives(campaignId: string, entries: CreativeEntry[]): CreativeAnalysis {
  const diagnoses: CreativeDiagnosis[] = [];

  // Spend concentration: any single creative > 60% of spend
  for (const entry of entries) {
    if (entry.spendShare > 0.6) {
      diagnoses.push({
        creativeKey: entry.creativeKey,
        pattern: "spend_concentration",
        severity: "warning",
        message: `Creative ${entry.creativeKey} accounts for ${(entry.spendShare * 100).toFixed(0)}% of spend`,
      });
    }
  }

  // Underperforming outlier: cpa > 2x average (only meaningful with >1 entry)
  if (entries.length > 1) {
    const avgCpa = entries.reduce((sum, e) => sum + e.cpa, 0) / entries.length;

    for (const entry of entries) {
      if (entry.cpa > 2 * avgCpa) {
        diagnoses.push({
          creativeKey: entry.creativeKey,
          pattern: "underperforming_outlier",
          severity: "error",
          message: `Creative ${entry.creativeKey} CPA ($${entry.cpa.toFixed(2)}) is ${(entry.cpa / avgCpa).toFixed(1)}x the average ($${avgCpa.toFixed(2)})`,
        });
      }
    }
  }

  return { campaignId, entries, diagnoses };
}
