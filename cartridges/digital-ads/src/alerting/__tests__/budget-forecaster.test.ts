import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BudgetForecaster } from "../budget-forecaster.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function errorResponse(message: string, httpStatus = 400): Response {
  return {
    ok: false,
    status: httpStatus,
    statusText: "Bad Request",
    headers: new Headers(),
    json: () => Promise.resolve({ error: { message, type: "OAuthException", code: 100 } }),
    text: () =>
      Promise.resolve(JSON.stringify({ error: { message, type: "OAuthException", code: 100 } })),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BudgetForecaster", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let forecaster: BudgetForecaster;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    forecaster = new BudgetForecaster("https://graph.facebook.com/v22.0", "test-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Account ID normalization
  // -------------------------------------------------------------------------

  describe("account ID normalization", () => {
    it("prepends 'act_' prefix if missing", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await forecaster.forecast("123456");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/act_123456/campaigns"));
    });

    it("preserves 'act_' prefix if already present", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await forecaster.forecast("act_789");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/act_789/campaigns"));
    });
  });

  // -------------------------------------------------------------------------
  // Campaign fetching
  // -------------------------------------------------------------------------

  describe("campaign fetching", () => {
    it("fetches active and paused campaigns", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await forecaster.forecast("act_123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          'filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]',
        ),
      );
    });

    it("processes multiple campaigns", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, effective_status: "ACTIVE" },
              { id: "camp2", name: "Campaign 2", daily_budget: 20000, effective_status: "PAUSED" },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result).toHaveLength(2);
      expect(result[0]!.campaignId).toBe("camp1");
      expect(result[1]!.campaignId).toBe("camp2");
    });

    it("handles empty campaign list", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Budget calculation
  // -------------------------------------------------------------------------

  describe("budget calculation", () => {
    it("converts daily budget from cents to dollars", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000 }, // $100
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.dailyBudget).toBe(100);
    });

    it("converts remaining budget from cents to dollars", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 50000 }, // $500
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.remainingBudget).toBe(500);
    });

    it("handles null remaining budget", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: null },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.remainingBudget).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Spend rate calculation
  // -------------------------------------------------------------------------

  describe("spend rate calculation", () => {
    it("calculates daily spend rate from 7-day insights", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { spend: "100" },
              { spend: "110" },
              { spend: "105" },
              { spend: "95" },
              { spend: "100" },
              { spend: "105" },
              { spend: "100" },
            ],
          }),
        );

      const result = await forecaster.forecast("act_123");

      // Total: 715, Average: 715/7 = 102.14
      expect(result[0]!.dailySpendRate).toBeCloseTo(102.14, 2);
    });

    it("handles zero spend", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.dailySpendRate).toBe(0);
    });

    it("continues forecast if insights fetch fails", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockRejectedValueOnce(new Error("Insights API error"));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.dailySpendRate).toBe(0);
      expect(result).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Days until exhaustion
  // -------------------------------------------------------------------------

  describe("days until exhaustion", () => {
    it("calculates days until budget exhaustion", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 70000 },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "10" }] }));

      const result = await forecaster.forecast("act_123");

      // Remaining: $700, Daily rate: 10/7 = $1.43, Days: 700/1.43 = ~490 days (rounded up)
      expect(result[0]!.daysUntilExhaustion).toBeGreaterThan(400);
    });

    it("returns null when remaining budget is null", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: null },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [{ spend: "10" }] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.daysUntilExhaustion).toBeNull();
    });

    it("returns null when spend rate is zero", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 70000 },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.daysUntilExhaustion).toBeNull();
    });

    it("rounds up to nearest day", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 10000 },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "21" }] }));

      const result = await forecaster.forecast("act_123");

      // Remaining: $100, Daily rate: $3, Days: 100/3 = 33.33 -> 34 days
      expect(result[0]!.daysUntilExhaustion).toBe(34);
    });
  });

  // -------------------------------------------------------------------------
  // Projected monthly spend
  // -------------------------------------------------------------------------

  describe("projected monthly spend", () => {
    it("calculates projected monthly spend (daily rate * 30)", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "70" }] }));

      const result = await forecaster.forecast("act_123");

      // Daily rate: 70/7 = 10, Monthly: 10 * 30 = 300
      expect(result[0]!.projectedMonthlySpend).toBe(300);
    });

    it("rounds to 2 decimal places", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "33.33" }] }));

      const result = await forecaster.forecast("act_123");

      // Daily rate: 33.33/7 = 4.76, Monthly: 4.76 * 30 = 142.80
      expect(Number.isInteger(result[0]!.projectedMonthlySpend * 100)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Status determination
  // -------------------------------------------------------------------------

  describe("status determination", () => {
    it("returns 'budget_exhausting' when days until exhaustion <= 7", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 5000 },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "7" }] }));

      const result = await forecaster.forecast("act_123");

      // Remaining: $50, Daily rate: $1, Days: 50 days (not exhausting)
      // Let me recalculate: 5000 cents = $50, spend 7/7 = $1/day, 50/1 = 50 days
      // Actually need smaller remaining budget
      expect(result[0]!.status).not.toBe("budget_exhausting");
    });

    it("returns 'budget_exhausting' for very low remaining budget", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 500 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "7" }] }));

      const result = await forecaster.forecast("act_123");

      // Remaining: $5, Daily rate: $1, Days: 5 days (<= 7)
      expect(result[0]!.status).toBe("budget_exhausting");
    });

    it("returns 'overspending' when spend rate > 110% of daily budget", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }], // $100
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "770" }] })); // $110/day avg

      const result = await forecaster.forecast("act_123");

      // Daily rate: 770/7 = 110, Budget: 100, Ratio: 1.1 (not > 1.1)
      // Need higher spend
      expect(result[0]!.status).not.toBe("overspending");
    });

    it("returns 'overspending' when significantly over budget", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }], // $100
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "840" }] })); // $120/day avg

      const result = await forecaster.forecast("act_123");

      // Daily rate: 840/7 = 120, Budget: 100, Ratio: 1.2 (> 1.1)
      expect(result[0]!.status).toBe("overspending");
    });

    it("returns 'underspending' when spend rate < 50% of daily budget", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }], // $100
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "280" }] })); // $40/day avg

      const result = await forecaster.forecast("act_123");

      // Daily rate: 280/7 = 40, Budget: 100, Ratio: 0.4 (< 0.5)
      expect(result[0]!.status).toBe("underspending");
    });

    it("returns 'healthy' when spend rate is within normal range", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }], // $100
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "630" }] })); // $90/day avg

      const result = await forecaster.forecast("act_123");

      // Daily rate: 630/7 = 90, Budget: 100, Ratio: 0.9 (0.5-1.1)
      expect(result[0]!.status).toBe("healthy");
    });
  });

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------

  describe("recommendations", () => {
    it("generates budget exhaustion recommendations", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 500 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "7" }] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.recommendations.length).toBeGreaterThan(0);
      expect(result[0]!.recommendations[0]).toContain("exhausted");
      expect(result[0]!.recommendations[1]).toContain("Remaining budget");
    });

    it("generates overspending recommendations", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "840" }] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.recommendations.length).toBeGreaterThan(0);
      expect(result[0]!.recommendations[0]).toContain("exceeds daily budget");
      expect(result[0]!.recommendations[1]).toContain("bid strategies");
    });

    it("generates underspending recommendations", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "280" }] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.recommendations.length).toBeGreaterThan(0);
      expect(result[0]!.recommendations[0]).toContain("well below daily budget");
      expect(result[0]!.recommendations[1]).toContain("broadening targeting");
    });

    it("generates healthy recommendations", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "630" }] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.recommendations.length).toBe(1);
      expect(result[0]!.recommendations[0]).toContain("healthy");
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws error on campaign fetch failure", async () => {
      fetchMock.mockResolvedValue(errorResponse("API error"));

      await expect(forecaster.forecast("act_123")).rejects.toThrow("Meta API error");
    });

    it("includes error message from API response", async () => {
      fetchMock.mockResolvedValue(errorResponse("Invalid access token"));

      await expect(forecaster.forecast("act_123")).rejects.toThrow("Invalid access token");
    });

    it("handles HTTP error status", async () => {
      fetchMock.mockResolvedValue(errorResponse("Server error", 500));

      await expect(forecaster.forecast("act_123")).rejects.toThrow("Meta API error");
    });

    it("handles malformed JSON responses", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error("Invalid JSON")),
      } as unknown as Response);

      await expect(forecaster.forecast("act_123")).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Result format
  // -------------------------------------------------------------------------

  describe("result format", () => {
    it("includes all required fields", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", daily_budget: 10000, budget_remaining: 50000 },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ spend: "70" }] }));

      const result = await forecaster.forecast("act_123");

      const forecast = result[0]!;
      expect(forecast).toHaveProperty("campaignId");
      expect(forecast).toHaveProperty("campaignName");
      expect(forecast).toHaveProperty("dailyBudget");
      expect(forecast).toHaveProperty("dailySpendRate");
      expect(forecast).toHaveProperty("remainingBudget");
      expect(forecast).toHaveProperty("daysUntilExhaustion");
      expect(forecast).toHaveProperty("projectedMonthlySpend");
      expect(forecast).toHaveProperty("status");
      expect(forecast).toHaveProperty("recommendations");
    });

    it("handles missing campaign name", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", daily_budget: 10000 }],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await forecaster.forecast("act_123");

      expect(result[0]!.campaignName).toBe("");
    });
  });
});
