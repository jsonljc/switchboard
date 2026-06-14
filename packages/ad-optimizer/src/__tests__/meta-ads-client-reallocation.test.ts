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

    it("reads a NUMERIC daily_budget (Meta may send a JSON number, not a string) as cents", async () => {
      // Pins the String() coercion: a future parse that drops it would silently null a numeric budget.
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE", daily_budget: 5000 }),
      });
      expect((await client.getCampaign("camp_1")).dailyBudgetCents).toBe(5000);
    });
  });

  describe("getAccountDailySpendCents (blast-radius denominator)", () => {
    it("reads today's account spend (a DOLLARS string) and converts to CENTS (x100)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ spend: "5000.00" }] }),
      });
      expect(await client.getAccountDailySpendCents()).toBe(500000); // $5000.00 -> 500000 cents (NOT 5000)
      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("/act_123456/insights");
      expect(url).toContain("date_preset=today");
    });

    it("null when no insights row exists (absent -> blast-radius SHARE_CAP fail-closed)", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) });
      expect(await client.getAccountDailySpendCents()).toBeNull();
    });

    it("null on a non-numeric spend (strict parse, never coerces '5000abc')", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ spend: "5000abc" }] }),
      });
      expect(await client.getAccountDailySpendCents()).toBeNull();
    });

    it("THROWS on a Meta error (load-bearing; executor maps to ACCOUNT_SPEND_UNREADABLE)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: "nope", type: "x", code: 100 } }),
      });
      await expect(client.getAccountDailySpendCents()).rejects.toThrow(
        "Meta API error (400): nope",
      );
    });

    it("rounds an IEEE-754-imperfect product to exact cents ('0.29' -> 29, not 28)", async () => {
      // Pins the Math.round: 0.29 * 100 === 28.999999999999996 in IEEE-754; a truncating refactor
      // (| 0 / Math.trunc) would under-count the denominator (inflating the share, wrong direction).
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ spend: "0.29" }] }),
      });
      expect(await client.getAccountDailySpendCents()).toBe(29);
    });

    it("converts a single-decimal spend ('5000.5' -> 500050)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ spend: "5000.5" }] }),
      });
      expect(await client.getAccountDailySpendCents()).toBe(500050);
    });
  });

  describe("updateCampaignBudget (write)", () => {
    it("POSTs daily_budget in CENTS verbatim (no x100, no division)", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
      await client.updateCampaignBudget("camp_1", 5000);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${BASE_URL}/camp_1`);
      expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
        daily_budget: 5000,
      });
    });

    it("allows a budget edit on an ACTIVE campaign (only status->ACTIVE is forbidden)", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
      await expect(client.updateCampaignBudget("camp_active", 3000)).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("REFUSES a non-integer cents value WITHOUT calling Meta", async () => {
      await expect(client.updateCampaignBudget("camp_1", 50.5)).rejects.toThrow(/integer cents/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("REFUSES a non-safe-integer value WITHOUT calling Meta", async () => {
      await expect(
        client.updateCampaignBudget("camp_1", Number.MAX_SAFE_INTEGER + 2),
      ).rejects.toThrow(/integer cents/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("REFUSES a non-positive budget WITHOUT calling Meta", async () => {
      await expect(client.updateCampaignBudget("camp_1", 0)).rejects.toThrow(/positive/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("REFUSES an absurd budget above the sanity ceiling WITHOUT calling Meta (100x-bug tripwire)", async () => {
      await expect(client.updateCampaignBudget("camp_1", 1_000_000_01)).rejects.toThrow(
        /sanity ceiling/i,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("REFUSES a non-finite budget WITHOUT calling Meta (NaN-guard)", async () => {
      await expect(client.updateCampaignBudget("camp_1", Number.NaN)).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("THROWS on a Meta error (executor marks the attempt recovery_required)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: "budget too low", type: "x", code: 100 } }),
      });
      await expect(client.updateCampaignBudget("camp_1", 100)).rejects.toThrow(
        "Meta API error (400): budget too low",
      );
    });
  });
});
