import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RealMetaAdsWriteProvider,
  MockMetaAdsWriteProvider,
  MetaApiError,
  MetaAuthError,
  createMetaAdsWriteProvider,
} from "../meta-write-provider.js";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

function errorResponse(code: number, message: string, httpStatus = 400, subcode = 0): Response {
  return jsonResponse(
    {
      error: {
        message,
        code,
        error_subcode: subcode,
        type: "OAuthException",
        fbtrace_id: "trace123",
      },
    },
    httpStatus,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RealMetaAdsWriteProvider", () => {
  let provider: RealMetaAdsWriteProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RealMetaAdsWriteProvider({
      accessToken: "test-token-long-enough-for-production",
      adAccountId: "act_123456789",
      apiVersion: "v21.0",
    });
  });

  // ── Campaign CRUD ──────────────────────────────────────────────────────

  describe("getCampaign", () => {
    it("fetches campaign by ID and returns parsed CampaignInfo", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "camp_1",
          name: "Test Campaign",
          status: "ACTIVE",
          daily_budget: "5000",
          lifetime_budget: null,
          effective_status: "ACTIVE",
          start_time: "2026-01-01T00:00:00+0000",
          stop_time: null,
          objective: "OUTCOME_LEADS",
        }),
      );

      const result = await provider.getCampaign("camp_1");

      expect(result.id).toBe("camp_1");
      expect(result.name).toBe("Test Campaign");
      expect(result.status).toBe("ACTIVE");
      expect(result.dailyBudget).toBe(5000);
      expect(result.objective).toBe("OUTCOME_LEADS");
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0]![0]).toContain("camp_1");
      expect(mockFetch.mock.calls[0]![0]).toContain("access_token=test-token");
    });
  });

  describe("searchCampaigns", () => {
    it("returns paginated campaigns", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ id: "c1", name: "Camp 1", status: "ACTIVE", daily_budget: "1000" }],
            paging: { next: "https://graph.facebook.com/next-page" },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ id: "c2", name: "Camp 2", status: "PAUSED", daily_budget: "2000" }],
          }),
        );

      const results = await provider.searchCampaigns("test");

      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe("c1");
      expect(results[1]!.id).toBe("c2");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("handles empty search results", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

      const results = await provider.searchCampaigns("");

      expect(results).toHaveLength(0);
    });
  });

  describe("pauseCampaign", () => {
    it("pauses a campaign and returns previous status", async () => {
      // First call: getCampaign to get current status
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: "c1", name: "Test", status: "ACTIVE", daily_budget: "1000" }),
      );
      // Second call: POST to pause
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await provider.pauseCampaign("c1");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("ACTIVE");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify the POST body
      const postCall = mockFetch.mock.calls[1]!;
      expect(postCall[1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({ status: "PAUSED" }),
      });
    });
  });

  describe("resumeCampaign", () => {
    it("resumes a campaign and returns previous status", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: "c1", name: "Test", status: "PAUSED", daily_budget: "1000" }),
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await provider.resumeCampaign("c1");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("PAUSED");
    });
  });

  describe("updateBudget", () => {
    it("updates daily budget and returns previous value", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: "c1", name: "Test", status: "ACTIVE", daily_budget: "5000" }),
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await provider.updateBudget("c1", 10000);

      expect(result.success).toBe(true);
      expect(result.previousBudget).toBe(5000);
    });
  });

  describe("createCampaign", () => {
    it("creates a campaign with correct parameters", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "camp_new" }));

      const result = await provider.createCampaign({
        name: "New Campaign",
        objective: "OUTCOME_LEADS",
        dailyBudget: 50,
      });

      expect(result.id).toBe("camp_new");
      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.name).toBe("New Campaign");
      expect(body.objective).toBe("OUTCOME_LEADS");
      expect(body.status).toBe("PAUSED"); // default
      expect(body.daily_budget).toBe("5000"); // 50 * 100 cents
    });

    it("includes special_ad_categories when provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "camp_new" }));

      await provider.createCampaign({
        name: "Housing Campaign",
        objective: "OUTCOME_LEADS",
        dailyBudget: 50,
        specialAdCategories: ["HOUSING"],
      });

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.special_ad_categories).toEqual(["HOUSING"]);
    });
  });

  // ── Ad Set CRUD ────────────────────────────────────────────────────────

  describe("createAdSet", () => {
    it("creates an ad set with targeting", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "adset_new" }));

      const result = await provider.createAdSet({
        campaignId: "camp_1",
        name: "US Audience",
        dailyBudget: 25,
        targeting: { geo_locations: { countries: ["US"] } },
        optimizationGoal: "LEAD_GENERATION",
      });

      expect(result.id).toBe("adset_new");
      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.campaign_id).toBe("camp_1");
      expect(body.daily_budget).toBe("2500"); // 25 * 100
      expect(body.optimization_goal).toBe("LEAD_GENERATION");
    });
  });

  // ── Ad Creation ────────────────────────────────────────────────────────

  describe("createAd", () => {
    it("creates creative first then ad", async () => {
      // First call: create creative
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "creative_1" }));
      // Second call: create ad
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "ad_1" }));

      const result = await provider.createAd({
        adSetId: "adset_1",
        name: "Test Ad",
        creative: { page_id: "page_1", link_data: { link: "https://example.com" } },
      });

      expect(result.id).toBe("ad_1");
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify ad body references the created creative
      const adBody = JSON.parse(mockFetch.mock.calls[1]![1]!.body as string);
      expect(adBody.creative.creative_id).toBe("creative_1");
      expect(adBody.adset_id).toBe("adset_1");
    });
  });

  // ── Lead Forms API ─────────────────────────────────────────────────────

  describe("getLeadForms", () => {
    it("fetches lead forms for a page", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "form_1", name: "Contact Us", status: "ACTIVE", created_time: "2026-01-01" },
            {
              id: "form_2",
              name: "Book Appointment",
              status: "ACTIVE",
              created_time: "2026-02-01",
            },
          ],
        }),
      );

      const forms = await provider.getLeadForms("page_123");

      expect(forms).toHaveLength(2);
      expect(forms[0]!.id).toBe("form_1");
      expect(forms[0]!.name).toBe("Contact Us");
      expect(forms[0]!.pageId).toBe("page_123");
      expect(mockFetch.mock.calls[0]![0]).toContain("page_123/leadgen_forms");
    });
  });

  describe("getLeadFormData", () => {
    it("fetches lead entries with pagination", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              {
                id: "lead_1",
                created_time: "2026-03-01T10:00:00",
                field_data: [{ name: "email", values: ["a@b.com"] }],
              },
            ],
            paging: { next: "https://graph.facebook.com/next" },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              {
                id: "lead_2",
                created_time: "2026-03-02T10:00:00",
                field_data: [{ name: "email", values: ["c@d.com"] }],
              },
            ],
          }),
        );

      const entries = await provider.getLeadFormData("form_1");

      expect(entries).toHaveLength(2);
      expect(entries[0]!.id).toBe("lead_1");
      expect(entries[1]!.id).toBe("lead_2");
    });

    it("applies since filter when provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

      await provider.getLeadFormData("form_1", { since: 1709251200 });

      expect(mockFetch.mock.calls[0]![0]).toContain("GREATER_THAN");
      expect(mockFetch.mock.calls[0]![0]).toContain("1709251200");
    });
  });

  // ── Conversions API (CAPI) ─────────────────────────────────────────────

  describe("sendConversionEvent", () => {
    it("sends a conversion event to the pixel", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ events_received: 1 }));

      const result = await provider.sendConversionEvent("pixel_123", {
        eventName: "Lead",
        eventTime: 1709251200,
        actionSource: "website",
        userData: { em: ["hashed_email"] },
        customData: { value: 100, currency: "USD" },
      });

      expect(result.success).toBe(true);
      expect(result.eventsReceived).toBe(1);

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain("pixel_123/events");

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.data[0].event_name).toBe("Lead");
      expect(body.data[0].action_source).toBe("website");
      expect(body.data[0].custom_data.value).toBe(100);
    });
  });

  // ── Insights API ───────────────────────────────────────────────────────

  describe("getAccountInsights", () => {
    it("fetches account-level insights", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [{ spend: "1000", impressions: "50000", clicks: "2500" }],
        }),
      );

      const results = await provider.getAccountInsights("act_123456789", {
        dateRange: { since: "2026-03-01", until: "2026-03-07" },
        fields: ["spend", "impressions", "clicks"],
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.spend).toBe("1000");
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain("act_123456789/insights");
    });
  });

  describe("getCampaignInsights", () => {
    it("fetches campaign-level insights with breakdowns", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ spend: "500", impressions: "25000" }] }),
      );

      const results = await provider.getCampaignInsights("camp_1", {
        dateRange: { since: "2026-03-01", until: "2026-03-07" },
        fields: ["spend", "impressions"],
        breakdowns: ["age", "gender"],
      });

      expect(results).toHaveLength(1);
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain("camp_1/insights");
      expect(url).toContain("breakdowns=age%2Cgender");
    });
  });

  // ── Retry & Error Handling ─────────────────────────────────────────────

  describe("retry behavior", () => {
    it("retries on rate limit (code 17) with backoff", async () => {
      // Override delay to avoid real waiting
      vi.spyOn(
        provider as unknown as { delay: (ms: number) => Promise<void> },
        "delay",
      ).mockResolvedValue(undefined);

      mockFetch
        .mockResolvedValueOnce(errorResponse(17, "Rate limited", 400))
        .mockResolvedValueOnce(
          jsonResponse({ id: "c1", name: "Test", status: "ACTIVE", daily_budget: "1000" }),
        );

      const result = await provider.getCampaign("c1");

      expect(result.id).toBe("c1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries on 5xx server errors", async () => {
      vi.spyOn(
        provider as unknown as { delay: (ms: number) => Promise<void> },
        "delay",
      ).mockResolvedValue(undefined);

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: { message: "Server error" } }, 500))
        .mockResolvedValueOnce(
          jsonResponse({ id: "c1", name: "Test", status: "ACTIVE", daily_budget: "1000" }),
        );

      const result = await provider.getCampaign("c1");

      expect(result.id).toBe("c1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws MetaAuthError immediately on code 190 (no retry)", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(190, "Invalid OAuth access token", 401));

      await expect(provider.getCampaign("c1")).rejects.toThrow(MetaAuthError);
      expect(mockFetch).toHaveBeenCalledOnce(); // no retries
    });

    it("throws MetaApiError on non-retryable errors", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(100, "Invalid parameter", 400));

      await expect(provider.getCampaign("c1")).rejects.toThrow(MetaApiError);
    });

    it("throws after exhausting retries on rate limit", async () => {
      vi.spyOn(
        provider as unknown as { delay: (ms: number) => Promise<void> },
        "delay",
      ).mockResolvedValue(undefined);

      mockFetch.mockResolvedValue(errorResponse(17, "Rate limited", 400));

      await expect(provider.getCampaign("c1")).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    });
  });

  // ── Health Check ───────────────────────────────────────────────────────

  describe("healthCheck", () => {
    it("returns connected status when /me succeeds", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "user_1", name: "Test User" }));

      const health = await provider.healthCheck();

      expect(health.status).toBe("connected");
      expect(health.error).toBeNull();
      expect(health.capabilities.length).toBeGreaterThan(0);
    });

    it("returns disconnected status on error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const health = await provider.healthCheck();

      expect(health.status).toBe("disconnected");
      expect(health.error).toContain("Network error");
    });
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("createMetaAdsWriteProvider", () => {
  it("returns MockMetaAdsWriteProvider for short tokens", () => {
    const provider = createMetaAdsWriteProvider({
      accessToken: "short",
      adAccountId: "act_123",
    });
    expect(provider).toBeInstanceOf(MockMetaAdsWriteProvider);
  });

  it("returns MockMetaAdsWriteProvider for 'mock-token'", () => {
    const provider = createMetaAdsWriteProvider({
      accessToken: "mock-token",
      adAccountId: "act_123",
    });
    expect(provider).toBeInstanceOf(MockMetaAdsWriteProvider);
  });

  it("returns RealMetaAdsWriteProvider for production-length tokens", () => {
    const provider = createMetaAdsWriteProvider({
      accessToken: "EAABsbCS1234567890abcdefg",
      adAccountId: "act_123",
    });
    expect(provider).toBeInstanceOf(RealMetaAdsWriteProvider);
  });
});

// ---------------------------------------------------------------------------
// MockMetaAdsWriteProvider
// ---------------------------------------------------------------------------

describe("MockMetaAdsWriteProvider", () => {
  const mock = new MockMetaAdsWriteProvider();

  it("returns canned campaign data", async () => {
    const campaign = await mock.getCampaign("test_id");
    expect(campaign.id).toBe("test_id");
    expect(campaign.status).toBe("ACTIVE");
  });

  it("returns canned lead forms", async () => {
    const forms = await mock.getLeadForms("page_1");
    expect(forms.length).toBeGreaterThan(0);
    expect(forms[0]!.pageId).toBe("page_1");
  });

  it("returns canned lead data", async () => {
    const entries = await mock.getLeadFormData("form_1");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.fieldData.length).toBeGreaterThan(0);
  });

  it("returns success for CAPI events", async () => {
    const result = await mock.sendConversionEvent("pixel_1", {
      eventName: "Lead",
      eventTime: 1709251200,
      actionSource: "website",
      userData: {},
    });
    expect(result.success).toBe(true);
    expect(result.eventsReceived).toBe(1);
  });

  it("returns canned insights", async () => {
    const insights = await mock.getAccountInsights("act_123", {
      dateRange: { since: "2026-03-01", until: "2026-03-07" },
      fields: ["spend"],
    });
    expect(insights.length).toBeGreaterThan(0);
  });
});
