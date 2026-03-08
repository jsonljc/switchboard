// ---------------------------------------------------------------------------
// Tests — CreativeAnalyzer
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { CreativeAnalyzer } from "../creative-analyzer.js";

const BASE_URL = "https://graph.facebook.com/v21.0";
const TOKEN = "test-token";

function makeAd(overrides: Record<string, unknown> = {}) {
  return {
    id: "ad_1",
    name: "Default Ad",
    creative: { id: "cr_1", object_type: "IMAGE" },
    insights: {
      data: [
        {
          spend: "100.00",
          impressions: "10000",
          clicks: "150",
          ctr: "1.5",
          cpc: "0.67",
          frequency: "2.0",
          actions: [
            { action_type: "purchase", value: "5" },
            { action_type: "link_click", value: "100" },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("CreativeAnalyzer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("analyzes multiple ads", async () => {
    const ads = {
      data: [
        makeAd({ id: "ad_1", name: "Image Ad 1" }),
        makeAd({
          id: "ad_2",
          name: "Video Ad",
          creative: { id: "cr_2", object_type: "VIDEO" },
          insights: {
            data: [
              {
                spend: "200.00",
                impressions: "20000",
                clicks: "300",
                ctr: "1.5",
                cpc: "0.67",
                frequency: "3.0",
                actions: [{ action_type: "purchase", value: "12" }],
              },
            ],
          },
        }),
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(ads),
      } as unknown as Response),
    );

    const analyzer = new CreativeAnalyzer(BASE_URL, TOKEN);
    const result = await analyzer.analyze("act_123");

    expect(result.topPerformers.length).toBeGreaterThan(0);
    expect(result.formatMix.length).toBe(2);
    expect(result.recommendations).toBeDefined();
  });

  it("identifies top performers by CPA", async () => {
    const ads = {
      data: [
        makeAd({
          id: "ad_best",
          name: "Best Ad",
          insights: {
            data: [
              {
                spend: "50.00",
                impressions: "5000",
                clicks: "100",
                ctr: "2.0",
                cpc: "0.50",
                frequency: "1.5",
                actions: [{ action_type: "purchase", value: "10" }],
              },
            ],
          },
        }),
        makeAd({
          id: "ad_worst",
          name: "Worst Ad",
          insights: {
            data: [
              {
                spend: "200.00",
                impressions: "20000",
                clicks: "100",
                ctr: "0.5",
                cpc: "2.00",
                frequency: "1.0",
                actions: [{ action_type: "purchase", value: "2" }],
              },
            ],
          },
        }),
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(ads),
      } as unknown as Response),
    );

    const analyzer = new CreativeAnalyzer(BASE_URL, TOKEN);
    const result = await analyzer.analyze("123");

    // Best ad has CPA of $5, worst has CPA of $100
    expect(result.topPerformers[0]!.adId).toBe("ad_best");
    expect(result.topPerformers[0]!.cpa).toBe(5);
  });

  it("detects fatigue when frequency > 5", async () => {
    const ads = {
      data: [
        makeAd({
          id: "ad_fatigued",
          name: "Fatigued Ad",
          insights: {
            data: [
              {
                spend: "300.00",
                impressions: "30000",
                clicks: "150",
                ctr: "0.5",
                cpc: "2.00",
                frequency: "7.0",
                actions: [{ action_type: "purchase", value: "3" }],
              },
            ],
          },
        }),
        makeAd({
          id: "ad_fresh",
          name: "Fresh Ad",
          insights: {
            data: [
              {
                spend: "100.00",
                impressions: "10000",
                clicks: "200",
                ctr: "2.0",
                cpc: "0.50",
                frequency: "1.5",
                actions: [{ action_type: "purchase", value: "10" }],
              },
            ],
          },
        }),
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(ads),
      } as unknown as Response),
    );

    const analyzer = new CreativeAnalyzer(BASE_URL, TOKEN);
    const result = await analyzer.analyze("act_123");

    // Fatigued ad: frequency=7 -> freqFactor = min(7/5, 1) = 1.0, ctr=0.5 -> ctrPenalty=0.3
    // fatigueScore = min(1.0 + 0.3, 1) = 1.0 > 0.7
    expect(result.fatigued.length).toBeGreaterThanOrEqual(1);
    expect(result.fatigued.some((f) => f.adId === "ad_fatigued")).toBe(true);
    expect(result.recommendations.some((r) => r.toLowerCase().includes("fatigue"))).toBe(true);
  });

  it("analyzes format mix", async () => {
    const ads = {
      data: [
        makeAd({ id: "ad_1", creative: { id: "cr_1", object_type: "IMAGE" } }),
        makeAd({ id: "ad_2", creative: { id: "cr_2", object_type: "IMAGE" } }),
        makeAd({ id: "ad_3", creative: { id: "cr_3", object_type: "VIDEO" } }),
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(ads),
      } as unknown as Response),
    );

    const analyzer = new CreativeAnalyzer(BASE_URL, TOKEN);
    const result = await analyzer.analyze("act_123");

    expect(result.formatMix.length).toBe(2);
    const imageMix = result.formatMix.find((f) => f.format === "IMAGE");
    expect(imageMix).toBeDefined();
    expect(imageMix!.count).toBe(2);
    const videoMix = result.formatMix.find((f) => f.format === "VIDEO");
    expect(videoMix).toBeDefined();
    expect(videoMix!.count).toBe(1);
  });

  it("generates recommendations for single format", async () => {
    const ads = {
      data: [
        makeAd({ id: "ad_1", creative: { id: "cr_1", object_type: "IMAGE" } }),
        makeAd({ id: "ad_2", creative: { id: "cr_2", object_type: "IMAGE" } }),
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(ads),
      } as unknown as Response),
    );

    const analyzer = new CreativeAnalyzer(BASE_URL, TOKEN);
    const result = await analyzer.analyze("act_123");

    expect(result.recommendations.some((r) => r.includes("Only one creative format"))).toBe(true);
  });

  it("throws on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      } as unknown as Response),
    );

    const analyzer = new CreativeAnalyzer(BASE_URL, TOKEN);
    await expect(analyzer.analyze("act_123")).rejects.toThrow(
      "Failed to fetch creative data",
    );
  });
});
