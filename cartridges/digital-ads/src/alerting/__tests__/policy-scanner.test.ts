import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PolicyScanner } from "../policy-scanner.js";

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

describe("PolicyScanner", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let scanner: PolicyScanner;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    scanner = new PolicyScanner("https://graph.facebook.com/v22.0", "test-token");
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

      const result = await scanner.scan("123456");

      expect(result.adAccountId).toBe("act_123456");
    });

    it("preserves 'act_' prefix if already present", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_789");

      expect(result.adAccountId).toBe("act_789");
    });
  });

  // -------------------------------------------------------------------------
  // Disapproved ads detection
  // -------------------------------------------------------------------------

  describe("disapproved ads detection", () => {
    it("detects disapproved ads", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              {
                id: "ad1",
                name: "Test Ad 1",
                effective_status: "DISAPPROVED",
                ad_review_feedback: { global: { reason1: "Policy violation" } },
              },
              {
                id: "ad2",
                name: "Test Ad 2",
                effective_status: "DISAPPROVED",
                ad_review_feedback: { global: { reason1: "Misleading content" } },
              },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.disapprovedAds).toHaveLength(2);
      expect(result.disapprovedAds[0]!.adId).toBe("ad1");
      expect(result.disapprovedAds[0]!.adName).toBe("Test Ad 1");
      expect(result.disapprovedAds[0]!.reason).toContain("Policy violation");
    });

    it("detects ads with issues", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              {
                id: "ad1",
                name: "Test Ad 1",
                effective_status: "WITH_ISSUES",
                ad_review_feedback: { global: { reason1: "Warning" } },
              },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.disapprovedAds).toHaveLength(1);
      expect(result.disapprovedAds[0]!.adId).toBe("ad1");
    });

    it("extracts multiple reasons from review feedback", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              {
                id: "ad1",
                name: "Test Ad 1",
                effective_status: "DISAPPROVED",
                ad_review_feedback: {
                  global: { reason1: "Policy violation", reason2: "Misleading content" },
                },
              },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.disapprovedAds[0]!.reason).toContain("Policy violation");
      expect(result.disapprovedAds[0]!.reason).toContain("Misleading content");
    });

    it("handles missing review feedback", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              {
                id: "ad1",
                name: "Test Ad 1",
                effective_status: "DISAPPROVED",
              },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.disapprovedAds[0]!.reason).toBe("Unknown policy violation");
    });

    it("handles empty review feedback", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              {
                id: "ad1",
                name: "Test Ad 1",
                effective_status: "DISAPPROVED",
                ad_review_feedback: { global: {} },
              },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.disapprovedAds[0]!.reason).toBe("Unknown policy violation");
    });

    it("adds issue message for disapproved ads", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "ad1", name: "Ad 1", effective_status: "DISAPPROVED" },
              { id: "ad2", name: "Ad 2", effective_status: "DISAPPROVED" },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.issues).toContain("2 ad(s) have been disapproved or flagged.");
    });

    it("continues scan if ad check fails", async () => {
      fetchMock.mockRejectedValueOnce(new Error("API error")).mockResolvedValue(okResponse({}));

      const result = await scanner.scan("act_123");

      expect(result.disapprovedAds).toEqual([]);
      expect(result.issues).toContain("Failed to check for disapproved ads.");
    });
  });

  // -------------------------------------------------------------------------
  // Spend limit checks
  // -------------------------------------------------------------------------

  describe("spend limit checks", () => {
    it("detects approaching spend limit (>= 90%)", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            spend_cap: 100000, // $1000
            amount_spent: 95000, // $950 (95%)
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.spendLimitApproaching).toBe(true);
      expect(result.issues.some((issue) => issue.includes("95.0% utilized"))).toBe(true);
      expect(result.policyWarnings).toHaveLength(1);
      expect(result.policyWarnings[0]!.entityType).toBe("account");
      expect(result.policyWarnings[0]!.warning).toContain("95.0% used");
    });

    it("does not flag spend limit below 90%", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            spend_cap: 100000,
            amount_spent: 80000, // 80%
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.spendLimitApproaching).toBe(false);
    });

    it("handles no spend cap", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            spend_cap: 0,
            amount_spent: 50000,
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.spendLimitApproaching).toBe(false);
    });

    it("calculates remaining budget correctly", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            spend_cap: 100000, // $1000
            amount_spent: 95000, // $950
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      // Remaining: (100000 - 95000) / 100 = $50
      expect(result.issues.some((issue) => issue.includes("$50.00 remaining"))).toBe(true);
    });

    it("continues scan if spend limit check fails", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockRejectedValueOnce(new Error("API error"))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.spendLimitApproaching).toBe(false);
      expect(result.issues).toContain("Failed to check account spend limits.");
    });
  });

  // -------------------------------------------------------------------------
  // Campaign policy warnings
  // -------------------------------------------------------------------------

  describe("campaign policy warnings", () => {
    it("detects campaign policy issues", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({}))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              {
                id: "camp1",
                name: "Campaign 1",
                issues_info: [
                  { error_summary: "Budget too low", level: "warning" },
                  { error_summary: "Audience too small", level: "warning" },
                ],
              },
              {
                id: "camp2",
                name: "Campaign 2",
                issues_info: [{ level: "error" }],
              },
            ],
          }),
        );

      const result = await scanner.scan("act_123");

      expect(result.policyWarnings).toHaveLength(3);
      expect(result.policyWarnings[0]!.entityType).toBe("campaign");
      expect(result.policyWarnings[0]!.entityId).toBe("camp1");
      expect(result.policyWarnings[0]!.warning).toBe("Budget too low");
    });

    it("handles campaigns with no issues", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({}))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "camp1", name: "Campaign 1", issues_info: [] },
              { id: "camp2", name: "Campaign 2" },
            ],
          }),
        );

      const result = await scanner.scan("act_123");

      expect(result.policyWarnings).toEqual([]);
    });

    it("handles missing error_summary", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({}))
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", issues_info: [{ level: "warning" }] }],
          }),
        );

      const result = await scanner.scan("act_123");

      expect(result.policyWarnings[0]!.warning).toBe("warning");
    });

    it("uses fallback message when both error_summary and level missing", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({}))
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "camp1", name: "Campaign 1", issues_info: [{}] }],
          }),
        );

      const result = await scanner.scan("act_123");

      expect(result.policyWarnings[0]!.warning).toBe("Policy issue detected");
    });

    it("adds issue message for policy warnings", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({}))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              {
                id: "camp1",
                name: "Campaign 1",
                issues_info: [{ error_summary: "Issue 1" }, { error_summary: "Issue 2" }],
              },
            ],
          }),
        );

      const result = await scanner.scan("act_123");

      expect(result.issues).toContain("2 policy warning(s) detected across campaigns.");
    });

    it("continues scan if campaign check fails", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({}))
        .mockRejectedValueOnce(new Error("API error"));

      const result = await scanner.scan("act_123");

      expect(result.policyWarnings).toEqual([]);
      expect(result.issues).toContain("Failed to check campaign policy warnings.");
    });
  });

  // -------------------------------------------------------------------------
  // Overall health
  // -------------------------------------------------------------------------

  describe("overall health", () => {
    it("reports healthy when no issues detected", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.overallHealthy).toBe(true);
      expect(result.disapprovedAds).toEqual([]);
      expect(result.policyWarnings).toEqual([]);
      expect(result.spendLimitApproaching).toBe(false);
      expect(result.issues).toEqual([]);
    });

    it("reports unhealthy when disapproved ads exist", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "ad1", name: "Ad 1", effective_status: "DISAPPROVED" }],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.overallHealthy).toBe(false);
    });

    it("reports unhealthy when spend limit approaching", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ spend_cap: 100000, amount_spent: 95000 }))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result.overallHealthy).toBe(false);
    });

    it("reports unhealthy when issues exist", async () => {
      fetchMock.mockRejectedValueOnce(new Error("API error")).mockResolvedValue(okResponse({}));

      const result = await scanner.scan("act_123");

      expect(result.overallHealthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Scan metadata
  // -------------------------------------------------------------------------

  describe("scan metadata", () => {
    it("includes scannedAt timestamp", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      const before = new Date().toISOString();
      const result = await scanner.scan("act_123");
      const after = new Date().toISOString();

      expect(result.scannedAt).toBeDefined();
      expect(result.scannedAt >= before).toBe(true);
      expect(result.scannedAt <= after).toBe(true);
    });

    it("includes all required fields", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      const result = await scanner.scan("act_123");

      expect(result).toHaveProperty("adAccountId");
      expect(result).toHaveProperty("scannedAt");
      expect(result).toHaveProperty("disapprovedAds");
      expect(result).toHaveProperty("policyWarnings");
      expect(result).toHaveProperty("spendLimitApproaching");
      expect(result).toHaveProperty("overallHealthy");
      expect(result).toHaveProperty("issues");
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("continues scan when all checks fail", async () => {
      fetchMock.mockResolvedValue(errorResponse("API error"));

      const result = await scanner.scan("act_123");

      expect(result.adAccountId).toBe("act_123");
      expect(result.disapprovedAds).toEqual([]);
      expect(result.policyWarnings).toEqual([]);
      expect(result.spendLimitApproaching).toBe(false);
      expect(result.overallHealthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("includes error message from API response", async () => {
      fetchMock.mockResolvedValue(errorResponse("Invalid access token"));

      const result = await scanner.scan("act_123");

      // Should not throw, but should have issues
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("handles malformed JSON responses", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error("Invalid JSON")),
      } as unknown as Response);

      const result = await scanner.scan("act_123");

      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // API request format
  // -------------------------------------------------------------------------

  describe("API request format", () => {
    it("includes required fields in ads request", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await scanner.scan("act_123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("fields=id,name,effective_status,ad_review_feedback"),
      );
    });

    it("filters for disapproved and with_issues ads", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await scanner.scan("act_123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('value":["DISAPPROVED","WITH_ISSUES"]'),
      );
    });

    it("includes required fields in account request", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await scanner.scan("act_123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("fields=spend_cap,amount_spent"),
      );
    });

    it("includes required fields in campaigns request", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await scanner.scan("act_123");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("fields=id,name,issues_info"));
    });
  });
});
