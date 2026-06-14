// Spec-1B act leg: the Meta reallocation read/write primitives the read-modify-re-read executor
// consumes (close-the-revenue-loop spec section 7). Split out of meta-ads-client.test.ts to keep
// both files under the 600-line cap (feedback_arch_check_ts_only), mirroring the existing
// meta-ads-client-finite-guards / -adset-learning split.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaAdsClient } from "../meta-ads-client.js";

describe("MetaAdsClient — Spec-1B reallocation primitives", () => {
  let client: MetaAdsClient;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const BASE_URL = "https://graph.facebook.com/v21.0";

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    vi.useFakeTimers();
    client = new MetaAdsClient({ accessToken: "test-token", accountId: "act_123456" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("getCampaign (read-modify-re-read)", () => {
    it("reads daily_budget as CENTS verbatim (native minor units; NO x100) + status + name", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "camp_1",
            name: "Lunchtime",
            status: "ACTIVE",
            daily_budget: "5000",
          }),
      });
      const result = await client.getCampaign("camp_1");
      expect(result).toEqual({
        campaignId: "camp_1",
        name: "Lunchtime",
        status: "ACTIVE",
        dailyBudgetCents: 5000,
      });
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        `${BASE_URL}/camp_1?fields=id,name,status,daily_budget`,
      );
    });

    it("dailyBudgetCents:null when daily_budget is absent (ABO/ad-set budgeting; honest-null, never 0)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE" }),
      });
      expect((await client.getCampaign("camp_1")).dailyBudgetCents).toBeNull();
    });

    it("dailyBudgetCents:null on a non-numeric daily_budget (strict parse, never coerces '5000abc')", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE", daily_budget: "5000abc" }),
      });
      expect((await client.getCampaign("camp_1")).dailyBudgetCents).toBeNull();
    });

    it("dailyBudgetCents:null on zero/blank (zero is not a valid live daily budget)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE", daily_budget: "0" }),
      });
      expect((await client.getCampaign("camp_1")).dailyBudgetCents).toBeNull();
    });

    it("THROWS on a Meta error (load-bearing; executor maps to CAMPAIGN_BUDGET_UNREADABLE)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: "bad campaign", type: "x", code: 100 } }),
      });
      await expect(client.getCampaign("camp_1")).rejects.toThrow(
        "Meta API error (400): bad campaign",
      );
    });
  });
});
