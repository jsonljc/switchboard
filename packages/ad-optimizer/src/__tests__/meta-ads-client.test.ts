// packages/core/src/ad-optimizer/__tests__/meta-ads-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaAdsClient } from "../meta-ads-client.js";

describe("MetaAdsClient", () => {
  let client: MetaAdsClient;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const BASE_URL = "https://graph.facebook.com/v21.0";

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    vi.useFakeTimers();
    client = new MetaAdsClient({
      accessToken: "test-token",
      accountId: "act_123456",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("getCampaignInsights", () => {
    it("fetches with correct URL params and maps response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                campaign_id: "camp_1",
                campaign_name: "Summer Sale",
                status: "ACTIVE",
                effective_status: "ACTIVE",
                impressions: "50000",
                inline_link_clicks: "1200",
                spend: "350.50",
                conversions: "45",
                revenue: "2250.00",
                frequency: "2.5",
                cpm: "7.01",
                inline_link_click_ctr: "2.40",
                cost_per_inline_link_click: "0.29",
                date_start: "2024-01-01",
                date_stop: "2024-01-31",
              },
            ],
          }),
      });

      const result = await client.getCampaignInsights({
        dateRange: { since: "2024-01-01", until: "2024-01-31" },
        fields: ["impressions", "inline_link_clicks", "spend"],
        breakdowns: ["age"],
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain(`${BASE_URL}/act_123456/insights`);
      expect(callUrl).toContain("level=campaign");
      expect(callUrl).toContain(
        "time_range=%7B%22since%22%3A%222024-01-01%22%2C%22until%22%3A%222024-01-31%22%7D",
      );
      expect(callUrl).toContain("fields=impressions%2Cinline_link_clicks%2Cspend");
      expect(callUrl).toContain("breakdowns=age");

      const callOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(callOpts.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer test-token" }),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        campaignId: "camp_1",
        campaignName: "Summer Sale",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        impressions: 50000,
        inlineLinkClicks: 1200,
        spend: 350.5,
        conversions: 45,
        revenue: 2250.0,
        frequency: 2.5,
        cpm: 7.01,
        inlineLinkClickCtr: 2.4,
        costPerInlineLinkClick: 0.29,
        dateStart: "2024-01-01",
        dateStop: "2024-01-31",
      });
    });
  });

  describe("getAdSetInsights", () => {
    it("fetches ad set level insights with campaignId filter", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                adset_id: "adset_1",
                adset_name: "Lookalike US",
                campaign_id: "camp_1",
                impressions: "25000",
                inline_link_clicks: "600",
                spend: "175.25",
                conversions: "22",
                frequency: "1.8",
                cpm: "7.01",
                inline_link_click_ctr: "2.40",
                cost_per_inline_link_click: "0.29",
                date_start: "2024-01-01",
                date_stop: "2024-01-31",
              },
            ],
          }),
      });

      // Advance time past rate limit for any prior calls
      vi.advanceTimersByTime(61000);

      const result = await client.getAdSetInsights({
        dateRange: { since: "2024-01-01", until: "2024-01-31" },
        fields: ["impressions", "inline_link_clicks"],
        campaignId: "camp_1",
      });

      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("level=adset");
      expect(callUrl).toContain(
        "filtering=%5B%7B%22field%22%3A%22campaign.id%22%2C%22operator%22%3A%22EQUAL%22%2C%22value%22%3A%22camp_1%22%7D%5D",
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        adSetId: "adset_1",
        adSetName: "Lookalike US",
        campaignId: "camp_1",
        impressions: 25000,
        inlineLinkClicks: 600,
        spend: 175.25,
        conversions: 22,
        frequency: 1.8,
        cpm: 7.01,
        inlineLinkClickCtr: 2.4,
        costPerInlineLinkClick: 0.29,
        dateStart: "2024-01-01",
        dateStop: "2024-01-31",
      });
    });
  });

  describe("getAccountSummary", () => {
    it("fetches account metadata and insights", async () => {
      // First call: account metadata
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "act_123456",
            name: "My Ad Account",
            currency: "USD",
          }),
      });

      // Second call: account insights (need to advance timer)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                spend: "5000.00",
                impressions: "200000",
                clicks: "8000",
              },
            ],
          }),
      });

      // Third call: active campaigns count
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{}, {}, {}],
          }),
      });

      const summaryPromise = client.getAccountSummary();

      // Advance past rate limit for second call
      await vi.advanceTimersByTimeAsync(61000);
      // Advance past rate limit for third call
      await vi.advanceTimersByTimeAsync(61000);

      const result = await summaryPromise;

      expect(result).toEqual({
        accountId: "act_123456",
        accountName: "My Ad Account",
        currency: "USD",
        totalSpend: 5000,
        totalImpressions: 200000,
        totalClicks: 8000,
        activeCampaigns: 3,
      });
    });
  });

  describe("publish guard", () => {
    it("throws on ACTIVE status", async () => {
      await expect(client.updateCampaignStatus("camp_1", "ACTIVE")).rejects.toThrow(
        "SAFETY: Agent cannot activate campaigns. Human must publish via Ads Manager.",
      );

      // Should not have made any API call
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("allows PAUSED status", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await client.updateCampaignStatus("camp_1", "PAUSED");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("camp_1");

      const callOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(callOpts.body as string)).toEqual({ status: "PAUSED" });
    });

    it("allows DELETED status", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await client.updateCampaignStatus("camp_1", "DELETED");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("allows ARCHIVED status", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await client.updateCampaignStatus("camp_1", "ARCHIVED");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("createDraftCampaign", () => {
    it("always sends status: PAUSED in body", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "camp_new_1" }),
      });

      const result = await client.createDraftCampaign({
        name: "Test Campaign",
        objective: "CONVERSIONS",
        budget: { daily: 100 },
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      });

      expect(result).toEqual({ id: "camp_new_1" });

      const callOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(callOpts.body as string);
      expect(body.status).toBe("PAUSED");
      expect(body.name).toBe("Test Campaign");
      expect(body.objective).toBe("CONVERSIONS");
      expect(body.daily_budget).toBe(100);
      expect(body.bid_strategy).toBe("LOWEST_COST_WITHOUT_CAP");
    });

    it("sends lifetime_budget when lifetime budget is specified", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "camp_new_2" }),
      });

      // Advance past rate limit
      vi.advanceTimersByTime(61000);

      await client.createDraftCampaign({
        name: "Lifetime Campaign",
        objective: "REACH",
        budget: { lifetime: 5000 },
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      });

      const callOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(callOpts.body as string);
      expect(body.lifetime_budget).toBe(5000);
      expect(body.daily_budget).toBeUndefined();
    });
  });

  describe("createDraftAdSet", () => {
    it("creates ad set with PAUSED status", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "adset_new_1" }),
      });

      const result = await client.createDraftAdSet({
        campaignId: "camp_1",
        name: "US Lookalike",
        targeting: { geo_locations: { countries: ["US"] } },
        optimizationGoal: "CONVERSIONS",
      });

      expect(result).toEqual({ id: "adset_new_1" });

      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("act_123456/adsets");

      const callOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(callOpts.body as string);
      expect(body.status).toBe("PAUSED");
      expect(body.campaign_id).toBe("camp_1");
    });
  });

  describe("createAdCreative", () => {
    it("posts an object_story_spec with page_id + video_data and returns the id", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "cr_new_1" }),
      });

      const result = await client.createAdCreative({
        name: "Mira draft creative",
        pageId: "page_123",
        videoId: "vid_999",
        message: "Lunchtime refresh",
        linkUrl: "https://clinic.example/book",
        callToActionType: "BOOK_TRAVEL",
      });

      expect(result).toEqual({ id: "cr_new_1" });

      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("act_123456/adcreatives");

      const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.object_story_spec.page_id).toBe("page_123");
      expect(body.object_story_spec.video_data.video_id).toBe("vid_999");
      expect(body.object_story_spec.video_data.call_to_action.type).toBe("BOOK_TRAVEL");
      expect(body.object_story_spec.video_data.call_to_action.value.link).toBe(
        "https://clinic.example/book",
      );
    });
  });

  describe("createAd", () => {
    it("always sends status PAUSED and links the creative + ad set", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "ad_new_1" }),
      });

      const result = await client.createAd({
        name: "Mira draft ad",
        adSetId: "set_1",
        creativeId: "cr_1",
      });

      expect(result).toEqual({ id: "ad_new_1" });

      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("act_123456/ads");

      const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.status).toBe("PAUSED");
      expect(body.adset_id).toBe("set_1");
      expect(body.creative.creative_id).toBe("cr_1");
    });
  });

  describe("rate limiting", () => {
    it("enforces minimum interval between calls", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [],
          }),
      });

      // First call should go through immediately
      const p1 = client.getCampaignInsights({
        dateRange: { since: "2024-01-01", until: "2024-01-31" },
        fields: ["impressions"],
      });
      await p1;
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call should be delayed
      const p2 = client.getCampaignInsights({
        dateRange: { since: "2024-01-01", until: "2024-01-31" },
        fields: ["impressions"],
      });

      // Before the interval passes, fetch should not have been called again
      vi.advanceTimersByTime(30000);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // After 60 seconds, it should proceed
      vi.advanceTimersByTime(31000);
      await p2;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("throws descriptive error on API failure", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: {
              message: "Invalid parameter",
              type: "OAuthException",
              code: 100,
            },
          }),
      });

      await expect(
        client.getCampaignInsights({
          dateRange: { since: "2024-01-01", until: "2024-01-31" },
          fields: ["impressions"],
        }),
      ).rejects.toThrow("Meta API error (400): Invalid parameter");
    });

    it("handles non-JSON error responses", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not JSON")),
      });

      // Advance past rate limit
      vi.advanceTimersByTime(61000);

      await expect(
        client.getCampaignInsights({
          dateRange: { since: "2024-01-01", until: "2024-01-31" },
          fields: ["impressions"],
        }),
      ).rejects.toThrow("Meta API error (500): Unknown error");
    });
  });

  describe("uploadCreativeAsset", () => {
    it("uploads image and returns id + url", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "img_123",
            url: "https://scontent.xx.fbcdn.net/v/image.jpg",
          }),
      });

      const result = await client.uploadCreativeAsset({
        file: Buffer.from("fake-image-data"),
        type: "image",
      });

      expect(result).toEqual({
        id: "img_123",
        url: "https://scontent.xx.fbcdn.net/v/image.jpg",
      });
    });
  });

  describe("getAdCampaignId", () => {
    it("returns campaign_id from Graph API", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ campaign_id: "camp_123" }),
      });

      const result = await client.getAdCampaignId("ad_456");

      expect(result).toBe("camp_123");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("/ad_456?fields=campaign_id");
    });

    it("caches result on second call", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ campaign_id: "camp_123" }),
      });

      // Advance past rate limit for clarity
      vi.advanceTimersByTime(61000);

      const result1 = await client.getAdCampaignId("ad_456");
      const result2 = await client.getAdCampaignId("ad_456");

      expect(result1).toBe("camp_123");
      expect(result2).toBe("camp_123");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null on API error", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { message: "Ad not found" } }),
      });

      // Advance past rate limit
      vi.advanceTimersByTime(61000);

      const result = await client.getAdCampaignId("ad_nonexistent");

      expect(result).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("getCampaignInsights time_increment", () => {
  it("adds time_increment to the query when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    await client.getCampaignInsights({
      dateRange: { since: "2026-05-18", until: "2026-06-01" },
      fields: ["campaign_id", "spend", "conversions"],
      timeIncrement: 1,
    });
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("time_increment=1");
  });

  it("omits time_increment when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    await client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      fields: ["campaign_id"],
    });
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("time_increment");
  });
});

describe("getAdSetLearningInputs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps entity learning_stage_info + insights spend into AdSetLearningInput[]", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: adsets entity edge (learning_stage_info)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "as_1",
              name: "AdSet 1",
              campaign_id: "c_1",
              learning_stage_info: { status: "LEARNING" },
            },
            {
              id: "as_2",
              name: "AdSet 2",
              campaign_id: "c_1",
              learning_stage_info: { status: "SUCCESS" },
            },
          ],
        }),
      })
      // 2nd call: adset insights (spend etc.)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              adset_id: "as_1",
              spend: "300",
              conversions: "2",
              frequency: "1.5",
              inline_link_click_ctr: "1.0",
            },
            {
              adset_id: "as_2",
              spend: "100",
              conversions: "5",
              frequency: "1.2",
              inline_link_click_ctr: "1.4",
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    const rowsPromise = client.getAdSetLearningInputs("c_1");

    // Advance past rate limit for the second internal call (getAdSetInsights)
    await vi.advanceTimersByTimeAsync(61000);

    const rows = await rowsPromise;

    expect(rows).toHaveLength(2);
    const as1 = rows.find((r) => r.adSetId === "as_1")!;
    expect(as1.learningStageStatus).toBe("LEARNING");
    expect(as1.spend).toBe(300);
    expect(as1.campaignId).toBe("c_1");
    expect(rows.find((r) => r.adSetId === "as_2")!.learningStageStatus).toBe("SUCCESS");
  });
});

describe("fractional conversions", () => {
  it("preserves fractional conversions (parseFloat, not parseInt)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ campaign_id: "c_1", spend: "100", conversions: "2.5" }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    const rows = await client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      fields: ["campaign_id", "spend", "conversions"],
    });
    expect(rows[0]!.conversions).toBe(2.5);
  });
});

describe("action_attribution_windows + actions passthrough", () => {
  it("forwards action_attribution_windows and surfaces parsed actions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { campaign_id: "c1", spend: "100", actions: [{ action_type: "lead", value: "4" }] },
          ],
        }),
      ),
    );
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    const rows = await client.getCampaignInsights({
      dateRange: { since: "2026-05-01", until: "2026-05-07" },
      fields: ["campaign_id", "spend", "actions"],
      actionAttributionWindows: ["7d_click"],
    });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("action_attribution_windows");
    expect(rows[0]!.actions?.find((a) => a.action_type === "lead")?.value).toBe("4");
    fetchMock.mockRestore();
  });
});
