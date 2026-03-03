import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiReadAdapter } from "../adapters/api-read-adapter.js";
import type { McpApiClient } from "../api-client.js";
import type { ReadOperation } from "../adapters/api-read-adapter.js";

// ── Mock Client ────────────────────────────────────────────────────────

function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    idempotencyKey: vi.fn(() => "test-key"),
  } as unknown as McpApiClient;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("ApiReadAdapter", () => {
  let client: ReturnType<typeof createMockClient>;
  let adapter: ApiReadAdapter;

  beforeEach(() => {
    client = createMockClient();
    adapter = new ApiReadAdapter(client);
  });

  // ── getCampaign ────────────────────────────────────────────────────

  describe("getCampaign", () => {
    it("calls GET /api/campaigns/{id} and returns .campaign", async () => {
      const campaignData = { id: "camp_1", name: "Summer Sale" };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { campaign: campaignData },
      });

      const op: ReadOperation = {
        cartridgeId: "digital-ads",
        operation: "getCampaign",
        parameters: { campaignId: "camp_1" },
        actorId: "user_1",
      };

      const result = await adapter.query(op);

      expect(client.get).toHaveBeenCalledWith("/api/campaigns/camp_1");
      expect(result).toEqual(campaignData);
    });

    it("returns full data when .campaign is not present", async () => {
      const fallbackData = { id: "camp_2", name: "Winter Promo" };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: fallbackData,
      });

      const op: ReadOperation = {
        cartridgeId: "digital-ads",
        operation: "getCampaign",
        parameters: { campaignId: "camp_2" },
        actorId: "user_1",
      };

      const result = await adapter.query(op);
      expect(result).toEqual(fallbackData);
    });

    it("encodes campaignId in URL", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { campaign: {} },
      });

      const op: ReadOperation = {
        cartridgeId: "digital-ads",
        operation: "getCampaign",
        parameters: { campaignId: "camp/special&chars" },
        actorId: "user_1",
      };

      await adapter.query(op);

      expect(client.get).toHaveBeenCalledWith(
        `/api/campaigns/${encodeURIComponent("camp/special&chars")}`,
      );
    });
  });

  // ── searchCampaigns ────────────────────────────────────────────────

  describe("searchCampaigns", () => {
    it("calls GET /api/campaigns/search with query param", async () => {
      const searchResult = { campaigns: [{ id: "camp_1" }] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: searchResult,
      });

      const op: ReadOperation = {
        cartridgeId: "digital-ads",
        operation: "searchCampaigns",
        parameters: { query: "summer" },
        actorId: "user_1",
      };

      const result = await adapter.query(op);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining("/api/campaigns/search?"));
      expect(client.get).toHaveBeenCalledWith(expect.stringContaining("query=summer"));
      expect(result).toEqual(searchResult);
    });

    it("includes limit parameter when provided", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { campaigns: [] },
      });

      const op: ReadOperation = {
        cartridgeId: "digital-ads",
        operation: "searchCampaigns",
        parameters: { query: "winter", limit: 5 },
        actorId: "user_1",
      };

      await adapter.query(op);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining("limit=5"));
    });

    it("omits limit parameter when not provided", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { campaigns: [] },
      });

      const op: ReadOperation = {
        cartridgeId: "digital-ads",
        operation: "searchCampaigns",
        parameters: { query: "spring" },
        actorId: "user_1",
      };

      await adapter.query(op);

      const calledUrl = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(calledUrl).not.toContain("limit=");
    });
  });

  // ── Unknown Operation ──────────────────────────────────────────────

  describe("unknown operation", () => {
    it("throws an Error for unsupported operations", async () => {
      const op: ReadOperation = {
        cartridgeId: "digital-ads",
        operation: "deleteCampaign",
        parameters: {},
        actorId: "user_1",
      };

      await expect(adapter.query(op)).rejects.toThrow("Unsupported read operation: deleteCampaign");
    });
  });
});
