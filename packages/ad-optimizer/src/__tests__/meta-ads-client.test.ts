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
                clicks: "1200",
                spend: "350.50",
                conversions: "45",
                revenue: "2250.00",
                frequency: "2.5",
                cpm: "7.01",
                ctr: "2.40",
                cpc: "0.29",
                date_start: "2024-01-01",
                date_stop: "2024-01-31",
              },
            ],
          }),
      });

      const result = await client.getCampaignInsights({
        dateRange: { since: "2024-01-01", until: "2024-01-31" },
        fields: ["impressions", "clicks", "spend"],
        breakdowns: ["age"],
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain(`${BASE_URL}/act_123456/insights`);
      expect(callUrl).toContain("level=campaign");
      expect(callUrl).toContain(
        "time_range=%7B%22since%22%3A%222024-01-01%22%2C%22until%22%3A%222024-01-31%22%7D",
      );
      expect(callUrl).toContain("fields=impressions%2Cclicks%2Cspend");
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
        clicks: 1200,
        spend: 350.5,
        conversions: 45,
        revenue: 2250.0,
        frequency: 2.5,
        cpm: 7.01,
        ctr: 2.4,
        cpc: 0.29,
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
                clicks: "600",
                spend: "175.25",
                conversions: "22",
                frequency: "1.8",
                cpm: "7.01",
                ctr: "2.40",
                cpc: "0.29",
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
        fields: ["impressions", "clicks"],
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
        clicks: 600,
        spend: 175.25,
        conversions: 22,
        frequency: 1.8,
        cpm: 7.01,
        ctr: 2.4,
        cpc: 0.29,
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
});
