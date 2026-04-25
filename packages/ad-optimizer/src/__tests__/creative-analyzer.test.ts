import { describe, it, expect } from "vitest";
import { deduplicateCreatives, analyzeCreatives, type RawAdData } from "../creative-analyzer.js";

function makeRawAd(overrides: Partial<RawAdData> = {}): RawAdData {
  return {
    adId: "ad-1",
    imageHash: "hash-a",
    videoId: null,
    spend: 100,
    impressions: 10000,
    clicks: 200,
    conversions: 10,
    ctr: 2.0,
    cpc: 0.5,
    cpa: 10,
    roas: 5,
    videoViews: null,
    qualityRanking: "ABOVE_AVERAGE",
    engagementRateRanking: "AVERAGE",
    conversionRateRanking: "BELOW_AVERAGE",
    ...overrides,
  };
}

describe("deduplicateCreatives", () => {
  it("groups two ads with the same image_hash and aggregates metrics", () => {
    const ads: RawAdData[] = [
      makeRawAd({
        adId: "ad-1",
        imageHash: "hash-a",
        spend: 100,
        impressions: 10000,
        clicks: 200,
        conversions: 10,
      }),
      makeRawAd({
        adId: "ad-2",
        imageHash: "hash-a",
        spend: 50,
        impressions: 5000,
        clicks: 100,
        conversions: 5,
      }),
    ];

    const entries = deduplicateCreatives(ads);

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.creativeKey).toBe("hash-a");
    expect(entry.keyType).toBe("image_hash");
    expect(entry.adIds).toEqual(["ad-1", "ad-2"]);
    expect(entry.spend).toBe(150);
    expect(entry.impressions).toBe(15000);
    expect(entry.clicks).toBe(300);
    expect(entry.conversions).toBe(15);
    // ctr = clicks/impressions*100 = 300/15000*100 = 2.0
    expect(entry.ctr).toBeCloseTo(2.0);
    // cpc = spend/clicks = 150/300 = 0.5
    expect(entry.cpc).toBeCloseTo(0.5);
    // cpa = spend/conversions = 150/15 = 10
    expect(entry.cpa).toBeCloseTo(10);
    // roas: weighted average by spend
    // ad1 roas=5 spend=100, ad2 roas=5 spend=50 => weighted = (5*100+5*50)/150 = 5
    expect(entry.roas).toBeCloseTo(5);
    expect(entry.thumbStopRatio).toBeNull();
    expect(entry.spendShare).toBeCloseTo(1.0);
  });

  it("uses video_id as creativeKey for video ads and calculates thumbStopRatio", () => {
    const ads: RawAdData[] = [
      makeRawAd({
        adId: "ad-v1",
        imageHash: "hash-x",
        videoId: "vid-1",
        spend: 200,
        impressions: 20000,
        clicks: 400,
        conversions: 20,
        videoViews: 8000,
      }),
      makeRawAd({
        adId: "ad-v2",
        imageHash: "hash-y",
        videoId: "vid-1",
        spend: 100,
        impressions: 10000,
        clicks: 200,
        conversions: 10,
        videoViews: 3000,
      }),
    ];

    const entries = deduplicateCreatives(ads);

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.creativeKey).toBe("vid-1");
    expect(entry.keyType).toBe("video_id");
    expect(entry.adIds).toEqual(["ad-v1", "ad-v2"]);
    // thumbStopRatio = totalVideoViews / totalImpressions * 100 = 11000/30000*100 = 36.67
    expect(entry.thumbStopRatio).toBeCloseTo(36.67, 1);
  });

  it("falls back to adId when both imageHash and videoId are null", () => {
    const ads: RawAdData[] = [
      makeRawAd({ adId: "ad-solo", imageHash: null, videoId: null, spend: 50, impressions: 5000 }),
    ];

    const entries = deduplicateCreatives(ads);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.creativeKey).toBe("ad-solo");
    expect(entries[0]!.keyType).toBe("image_hash");
    expect(entries[0]!.adIds).toEqual(["ad-solo"]);
  });
});

describe("analyzeCreatives", () => {
  it("detects spend concentration when spendShare > 0.6", () => {
    const entries = deduplicateCreatives([
      makeRawAd({
        adId: "ad-1",
        imageHash: "hash-a",
        spend: 750,
        impressions: 10000,
        clicks: 200,
        conversions: 10,
      }),
      makeRawAd({
        adId: "ad-2",
        imageHash: "hash-b",
        spend: 250,
        impressions: 10000,
        clicks: 200,
        conversions: 10,
      }),
    ]);

    const result = analyzeCreatives("camp-1", entries);

    const concDiag = result.diagnoses.find((d) => d.pattern === "spend_concentration");
    expect(concDiag).toBeDefined();
    expect(concDiag!.severity).toBe("warning");
    expect(concDiag!.creativeKey).toBe("hash-a");
  });

  it("detects underperforming outlier when cpa > 2x average", () => {
    // entry cpas: hash-a=150, hash-b=35, hash-c=35
    // avg cpa = (150+35+35)/3 = 73.33
    // 150 > 2*73.33 = 146.67? Yes!
    const entries = deduplicateCreatives([
      makeRawAd({
        adId: "ad-1",
        imageHash: "hash-a",
        spend: 150,
        impressions: 5000,
        clicks: 100,
        conversions: 1,
      }),
      makeRawAd({
        adId: "ad-2",
        imageHash: "hash-b",
        spend: 35,
        impressions: 5000,
        clicks: 100,
        conversions: 1,
      }),
      makeRawAd({
        adId: "ad-3",
        imageHash: "hash-c",
        spend: 35,
        impressions: 5000,
        clicks: 100,
        conversions: 1,
      }),
    ]);

    const result = analyzeCreatives("camp-1", entries);

    const outlier = result.diagnoses.find((d) => d.pattern === "underperforming_outlier");
    expect(outlier).toBeDefined();
    expect(outlier!.severity).toBe("error");
    expect(outlier!.creativeKey).toBe("hash-a");
  });

  it("returns no diagnoses when metrics are balanced", () => {
    const entries = deduplicateCreatives([
      makeRawAd({
        adId: "ad-1",
        imageHash: "hash-a",
        spend: 100,
        impressions: 10000,
        clicks: 200,
        conversions: 10,
      }),
      makeRawAd({
        adId: "ad-2",
        imageHash: "hash-b",
        spend: 100,
        impressions: 10000,
        clicks: 200,
        conversions: 10,
      }),
    ]);

    const result = analyzeCreatives("camp-1", entries);

    expect(result.diagnoses).toHaveLength(0);
    expect(result.campaignId).toBe("camp-1");
    expect(result.entries).toHaveLength(2);
  });
});
