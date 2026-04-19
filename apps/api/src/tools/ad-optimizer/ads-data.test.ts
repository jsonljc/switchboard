import { describe, it, expect, vi } from "vitest";
import { createAdsDataTool } from "./ads-data.js";

const mockAdsClient = {
  getCampaignInsights: vi.fn().mockResolvedValue([
    {
      campaignId: "c1",
      campaignName: "Test Campaign",
      spend: 100,
      impressions: 1000,
      clicks: 50,
    },
  ]),
  getAdSetInsights: vi.fn().mockResolvedValue([]),
  getAccountSummary: vi.fn().mockResolvedValue({
    accountId: "a1",
    accountName: "Test Account",
    currency: "USD",
    totalSpend: 1000,
    totalImpressions: 10000,
    totalClicks: 500,
    activeCampaigns: 3,
  }),
};

const mockCAPIClient = {
  dispatchEvent: vi.fn().mockResolvedValue({ eventsReceived: 1 }),
};

describe("ads-data tool", () => {
  const tool = createAdsDataTool({ adsClient: mockAdsClient, capiClient: mockCAPIClient });

  it("has correct id", () => {
    expect(tool.id).toBe("ads-data");
  });

  it("has 4 operations", () => {
    expect(Object.keys(tool.operations)).toEqual([
      "get-campaign-insights",
      "get-account-summary",
      "send-conversion-event",
      "parse-lead-webhook",
    ]);
  });

  it("read operations have read tier", () => {
    expect(tool.operations["get-campaign-insights"]!.governanceTier).toBe("read");
    expect(tool.operations["get-account-summary"]!.governanceTier).toBe("read");
    expect(tool.operations["parse-lead-webhook"]!.governanceTier).toBe("read");
  });

  it("send-conversion-event has external_write tier", () => {
    expect(tool.operations["send-conversion-event"]!.governanceTier).toBe("external_send");
  });

  describe("get-campaign-insights", () => {
    it("calls adsClient and returns results", async () => {
      const result = await tool.operations["get-campaign-insights"]!.execute({
        dateRange: { since: "2026-04-01", until: "2026-04-07" },
        fields: ["campaign_id", "spend"],
      });
      expect(mockAdsClient.getCampaignInsights).toHaveBeenCalledWith({
        dateRange: { since: "2026-04-01", until: "2026-04-07" },
        fields: ["campaign_id", "spend"],
      });
      expect((result as { insights: unknown[] }).insights).toHaveLength(1);
      expect((result as { insights: { campaignId: string }[] }).insights[0]?.campaignId).toBe("c1");
    });
  });

  describe("get-account-summary", () => {
    it("calls adsClient and returns summary", async () => {
      const result = await tool.operations["get-account-summary"]!.execute({});
      expect(mockAdsClient.getAccountSummary).toHaveBeenCalled();
      expect((result as { accountId: string }).accountId).toBe("a1");
      expect((result as { totalSpend: number }).totalSpend).toBe(1000);
    });
  });

  describe("send-conversion-event", () => {
    it("calls capiClient", async () => {
      const eventParams = {
        eventName: "Lead",
        eventTime: 1234567890,
        userData: { email: "test@example.com" },
      };
      const result = await tool.operations["send-conversion-event"]!.execute(eventParams);
      expect(mockCAPIClient.dispatchEvent).toHaveBeenCalledWith(eventParams);
      expect((result as { eventsReceived: number }).eventsReceived).toBe(1);
    });
  });

  describe("parse-lead-webhook", () => {
    it("parses lead data from webhook payload", async () => {
      const payload = {
        entry: [
          {
            id: "page1",
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: "123",
                  ad_id: "ad1",
                  form_id: "form1",
                  field_data: [
                    { name: "full_name", values: ["John Doe"] },
                    { name: "email", values: ["john@example.com"] },
                    { name: "phone_number", values: ["+1234567890"] },
                  ],
                },
              },
            ],
          },
        ],
      };
      const result = await tool.operations["parse-lead-webhook"]!.execute({ payload });
      expect(Array.isArray(result)).toBe(true);
      expect((result as { leadId: string }[]).length).toBe(1);
      expect((result as { leadId: string }[])[0]?.leadId).toBe("123");
    });
  });
});
