// ---------------------------------------------------------------------------
// Tests — ReportBuilder
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReportBuilder } from "../report-builder.js";

const BASE_URL = "https://graph.facebook.com/v21.0";
const TOKEN = "test-token";

function makeInsightsRow(overrides: Record<string, unknown> = {}) {
  return {
    spend: "100.00",
    impressions: "10000",
    clicks: "150",
    ctr: "1.5",
    cpm: "10.00",
    cpc: "0.67",
    reach: "8000",
    frequency: "1.25",
    actions: [
      { action_type: "purchase", value: "5" },
      { action_type: "link_click", value: "120" },
    ],
    cost_per_action_type: [
      { action_type: "purchase", value: "20.00" },
    ],
    ...overrides,
  };
}

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  } as unknown as Response);
}

describe("ReportBuilder", () => {
  let builder: ReportBuilder;

  beforeEach(() => {
    builder = new ReportBuilder(BASE_URL, TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── generatePerformanceReport ──────────────────────────────────────

  it("generates a performance report with basic params", async () => {
    const row = makeInsightsRow();
    vi.stubGlobal("fetch", mockFetchOk({ data: [row] }));

    const report = await builder.generatePerformanceReport({
      adAccountId: "123456",
    });

    expect(report.rows).toHaveLength(1);
    expect(report.level).toBe("account");
    expect(report.breakdowns).toEqual([]);
    expect(report.summary.totalSpend).toBe(100);
    expect(report.summary.totalImpressions).toBe(10000);
    expect(report.summary.totalClicks).toBe(150);
    expect(report.summary.totalConversions).toBe(5);
    expect(report.summary.avgCTR).toBeCloseTo(1.5, 1);
    expect(report.dateRange).toBeDefined();
    expect(report.dateRange.since).toBeDefined();
    expect(report.dateRange.until).toBeDefined();
  });

  // ── generateCreativeReport ────────────────────────────────────────

  it("generates a creative report", async () => {
    const adData = {
      data: [
        {
          id: "ad_1",
          name: "Image Ad",
          creative: { id: "cr_1", thumbnail_url: "https://example.com/thumb.jpg", object_type: "IMAGE" },
          insights: {
            data: [
              {
                spend: "50.00",
                impressions: "5000",
                clicks: "75",
                ctr: "1.5",
                cpc: "0.67",
                actions: [{ action_type: "purchase", value: "3" }],
                cost_per_action_type: [{ action_type: "purchase", value: "16.67" }],
              },
            ],
          },
        },
        {
          id: "ad_2",
          name: "Video Ad",
          creative: { id: "cr_2", thumbnail_url: null, object_type: "VIDEO" },
          insights: {
            data: [
              {
                spend: "80.00",
                impressions: "8000",
                clicks: "120",
                ctr: "1.5",
                cpc: "0.67",
                actions: [],
                cost_per_action_type: [],
              },
            ],
          },
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchOk(adData));

    const report = await builder.generateCreativeReport({
      adAccountId: "act_123456",
    });

    expect(report.creatives).toHaveLength(2);
    expect(report.creatives[0]!.adId).toBe("ad_1");
    expect(report.creatives[0]!.format).toBe("IMAGE");
    expect(report.creatives[0]!.conversions).toBe(3);
    expect(report.creatives[0]!.cpa).toBeCloseTo(16.67, 1);
    expect(report.creatives[1]!.conversions).toBe(0);
    expect(report.creatives[1]!.cpa).toBeNull();
    expect(report.dateRange).toBeDefined();
  });

  // ── generateAudienceReport ────────────────────────────────────────

  it("generates an audience report", async () => {
    const ageGenderData = {
      data: [
        {
          age: "25-34",
          gender: "male",
          spend: "60.00",
          impressions: "6000",
          clicks: "90",
          ctr: "1.5",
          actions: [{ action_type: "purchase", value: "2" }],
        },
      ],
    };
    const countryData = {
      data: [
        {
          country: "US",
          spend: "100.00",
          impressions: "10000",
          clicks: "150",
          ctr: "1.5",
          actions: [{ action_type: "lead", value: "4" }],
        },
      ],
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ageGenderData),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(countryData),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const report = await builder.generateAudienceReport({
      adAccountId: "123456",
    });

    expect(report.ageGender).toHaveLength(1);
    expect(report.ageGender[0]!.age).toBe("25-34");
    expect(report.ageGender[0]!.gender).toBe("male");
    expect(report.ageGender[0]!.conversions).toBe(2);
    expect(report.countries).toHaveLength(1);
    expect(report.countries[0]!.country).toBe("US");
    expect(report.countries[0]!.conversions).toBe(4);
  });

  // ── generatePlacementReport ───────────────────────────────────────

  it("generates a placement report", async () => {
    const placementData = {
      data: [
        {
          publisher_platform: "facebook",
          platform_position: "feed",
          spend: "70.00",
          impressions: "7000",
          clicks: "100",
          ctr: "1.43",
          cpm: "10.00",
          actions: [{ action_type: "purchase", value: "3" }],
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchOk(placementData));

    const report = await builder.generatePlacementReport({
      adAccountId: "123456",
    });

    expect(report.placements).toHaveLength(1);
    expect(report.placements[0]!.platform).toBe("facebook");
    expect(report.placements[0]!.position).toBe("feed");
    expect(report.placements[0]!.conversions).toBe(3);
    expect(report.placements[0]!.cpa).toBeCloseTo(23.33, 1);
  });

  // ── generateComparisonReport ──────────────────────────────────────

  it("generates a comparison report with two periods", async () => {
    const currentData = {
      data: [
        makeInsightsRow({ spend: "200.00", impressions: "20000", clicks: "300" }),
      ],
    };
    const previousData = {
      data: [
        makeInsightsRow({ spend: "100.00", impressions: "10000", clicks: "150" }),
      ],
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(currentData),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(previousData),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const report = await builder.generateComparisonReport({
      adAccountId: "123456",
      currentPeriod: { since: "2025-01-08", until: "2025-01-14" },
      previousPeriod: { since: "2025-01-01", until: "2025-01-07" },
    });

    expect(report.current).toHaveLength(1);
    expect(report.previous).toHaveLength(1);
    expect(report.changes.length).toBe(7);
    const spendChange = report.changes.find((c) => c.metric === "totalSpend");
    expect(spendChange).toBeDefined();
    expect(spendChange!.currentValue).toBe(200);
    expect(spendChange!.previousValue).toBe(100);
    expect(spendChange!.absoluteChange).toBe(100);
    expect(spendChange!.percentChange).toBeCloseTo(100);
  });

  // ── Summary computation ───────────────────────────────────────────

  it("computes summary correctly for multiple rows", async () => {
    const rows = [
      makeInsightsRow({ spend: "50.00", impressions: "5000", clicks: "80" }),
      makeInsightsRow({ spend: "150.00", impressions: "15000", clicks: "220" }),
    ];
    vi.stubGlobal("fetch", mockFetchOk({ data: rows }));

    const report = await builder.generatePerformanceReport({
      adAccountId: "123456",
    });

    expect(report.summary.totalSpend).toBe(200);
    expect(report.summary.totalImpressions).toBe(20000);
    expect(report.summary.totalClicks).toBe(300);
    expect(report.summary.totalConversions).toBe(10); // 5 per row * 2 rows
    expect(report.summary.avgCTR).toBeCloseTo(1.5, 1);
    expect(report.summary.avgCPM).toBeCloseTo(10, 1);
    expect(report.summary.avgCPC).toBeCloseTo(0.667, 1);
  });

  // ── Pagination handling ───────────────────────────────────────────

  it("handles pagination across multiple pages", async () => {
    const page1 = {
      data: [makeInsightsRow({ spend: "50.00" })],
      paging: { next: "https://graph.facebook.com/v21.0/page2" },
    };
    const page2 = {
      data: [makeInsightsRow({ spend: "75.00" })],
      paging: {},
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page1),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page2),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const report = await builder.generatePerformanceReport({
      adAccountId: "123456",
    });

    expect(report.rows).toHaveLength(2);
    expect(report.summary.totalSpend).toBe(125); // 50 + 75
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── Error handling ────────────────────────────────────────────────

  it("throws on failed API call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: "Invalid token" } }),
      } as unknown as Response),
    );

    await expect(
      builder.generatePerformanceReport({ adAccountId: "123456" }),
    ).rejects.toThrow("Meta API error: Invalid token");
  });

  it("throws with HTTP status when error body is not parseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("parse error")),
      } as unknown as Response),
    );

    await expect(
      builder.generatePerformanceReport({ adAccountId: "123456" }),
    ).rejects.toThrow("Meta API error: HTTP 500");
  });
});
