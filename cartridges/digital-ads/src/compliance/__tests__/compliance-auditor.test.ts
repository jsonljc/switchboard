import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ComplianceAuditor } from "../compliance-auditor.js";
import { ReviewChecker } from "../review-checker.js";
import type { AdReviewStatus } from "../types.js";

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

function makeMockAdReviewStatus(overrides: Partial<AdReviewStatus> = {}): AdReviewStatus {
  return {
    adId: "123",
    adName: "Test Ad",
    effectiveStatus: "ACTIVE",
    reviewFeedback: [],
    policyViolations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComplianceAuditor", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let auditor: ComplianceAuditor;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    auditor = new ComplianceAuditor("https://graph.facebook.com/v22.0", "test-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Account ID normalization
  // -------------------------------------------------------------------------

  describe("account ID normalization", () => {
    it("prepends 'act_' prefix if missing", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock.mockResolvedValue(okResponse({ special_ad_categories: [], data: [] }));

      const result = await auditor.audit("123456");

      expect(result.accountId).toBe("act_123456");
    });

    it("preserves 'act_' prefix if already present", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock.mockResolvedValue(okResponse({ special_ad_categories: [], data: [] }));

      const result = await auditor.audit("act_789");

      expect(result.accountId).toBe("act_789");
    });
  });

  // -------------------------------------------------------------------------
  // Review status checks
  // -------------------------------------------------------------------------

  describe("review status checks", () => {
    it("separates disapproved ads from ads with issues", async () => {
      const mockAds: AdReviewStatus[] = [
        makeMockAdReviewStatus({ adId: "1", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "2", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "3", effectiveStatus: "WITH_ISSUES" }),
        makeMockAdReviewStatus({ adId: "4", effectiveStatus: "PENDING_REVIEW" }),
      ];

      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue(mockAds);
      fetchMock.mockResolvedValue(okResponse({ special_ad_categories: [], data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.disapprovedAds).toHaveLength(2);
      expect(result.disapprovedAds[0]!.effectiveStatus).toBe("DISAPPROVED");
      expect(result.adsWithIssues).toHaveLength(2);
      expect(result.adsWithIssues[0]!.effectiveStatus).toBe("WITH_ISSUES");
    });

    it("continues audit even if review check fails", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockRejectedValue(
        new Error("Review check failed"),
      );
      fetchMock.mockResolvedValue(okResponse({ special_ad_categories: [], data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.disapprovedAds).toHaveLength(0);
      expect(result.adsWithIssues).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Special ad categories
  // -------------------------------------------------------------------------

  describe("special ad categories", () => {
    it("detects configured special ad categories", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: ["HOUSING", "EMPLOYMENT"] }))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.specialAdCategoriesConfigured).toBe(true);
      expect(result.specialAdCategories).toEqual(["HOUSING", "EMPLOYMENT"]);
    });

    it("detects empty special ad categories", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.specialAdCategoriesConfigured).toBe(false);
      expect(result.specialAdCategories).toEqual([]);
    });

    it("handles missing special_ad_categories field", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock.mockResolvedValueOnce(okResponse({})).mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.specialAdCategoriesConfigured).toBe(false);
      expect(result.specialAdCategories).toEqual([]);
    });

    it("continues audit if special ad categories check fails", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockRejectedValueOnce(new Error("Failed to fetch categories"))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.specialAdCategoriesConfigured).toBe(false);
      expect(result.specialAdCategories).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Pixel health checks
  // -------------------------------------------------------------------------

  describe("pixel health checks", () => {
    it("detects healthy pixel (available and recently fired)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(true);
    });

    it("detects unhealthy pixel (unavailable)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "pixel1", is_unavailable: true, last_fired_time: "2024-01-01T12:00:00Z" }],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(false);
    });

    it("detects unhealthy pixel (never fired)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "pixel1", is_unavailable: false, last_fired_time: null }],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(false);
    });

    it("handles multiple pixels (healthy if any is healthy)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: true, last_fired_time: null },
              { id: "pixel2", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
              { id: "pixel3", is_unavailable: false, last_fired_time: null },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(true);
    });

    it("handles no pixels", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(false);
    });

    it("continues audit if pixel health check fails", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockRejectedValueOnce(new Error("Failed to fetch pixels"))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // CAPI configuration checks
  // -------------------------------------------------------------------------

  describe("CAPI configuration checks", () => {
    it("detects CAPI configured (server events > 0)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1", is_unavailable: false }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ count_server: 100 }] }));

      const result = await auditor.audit("act_123");

      expect(result.capiConfigured).toBe(true);
    });

    it("detects CAPI not configured (server events = 0)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1", is_unavailable: false }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ count_server: 0 }] }));

      const result = await auditor.audit("act_123");

      expect(result.capiConfigured).toBe(false);
    });

    it("detects CAPI not configured (no server events)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1", is_unavailable: false }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.capiConfigured).toBe(false);
    });

    it("handles no pixels (CAPI not configured)", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.capiConfigured).toBe(false);
    });

    it("continues audit if CAPI check fails", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockRejectedValueOnce(new Error("Failed to fetch stats"));

      const result = await auditor.audit("act_123");

      expect(result.capiConfigured).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Score calculation
  // -------------------------------------------------------------------------

  describe("score calculation", () => {
    it("returns perfect score (100) with no issues", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ count_server: 100 }] }));

      const result = await auditor.audit("act_123");

      expect(result.overallScore).toBe(100);
      expect(result.issues).toEqual([]);
      expect(result.recommendations).toEqual([]);
    });

    it("deducts 15 points per disapproved ad", async () => {
      const mockAds: AdReviewStatus[] = [
        makeMockAdReviewStatus({ adId: "1", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "2", effectiveStatus: "DISAPPROVED" }),
      ];

      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue(mockAds);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ count_server: 100 }] }));

      const result = await auditor.audit("act_123");

      expect(result.overallScore).toBe(70); // 100 - (2 * 15)
      expect(result.issues).toContain("2 ad(s) disapproved");
    });

    it("deducts 5 points per ad with issues", async () => {
      const mockAds: AdReviewStatus[] = [
        makeMockAdReviewStatus({ adId: "1", effectiveStatus: "WITH_ISSUES" }),
        makeMockAdReviewStatus({ adId: "2", effectiveStatus: "PENDING_REVIEW" }),
        makeMockAdReviewStatus({ adId: "3", effectiveStatus: "WITH_ISSUES" }),
      ];

      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue(mockAds);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ count_server: 100 }] }));

      const result = await auditor.audit("act_123");

      expect(result.overallScore).toBe(85); // 100 - (3 * 5)
      expect(result.issues).toContain("3 ad(s) with review issues");
    });

    it("deducts 20 points for no healthy pixel", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.overallScore).toBe(70); // 100 - 20 - 10 (no CAPI either)
      expect(result.issues).toContain("No healthy pixel detected");
    });

    it("deducts 10 points for CAPI not configured", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.overallScore).toBe(90); // 100 - 10
      expect(result.issues).toContain("Conversions API (CAPI) not configured");
    });

    it("combines all deductions correctly", async () => {
      const mockAds: AdReviewStatus[] = [
        makeMockAdReviewStatus({ adId: "1", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "2", effectiveStatus: "WITH_ISSUES" }),
      ];

      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue(mockAds);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      // 100 - 15 (disapproved) - 5 (with issues) - 20 (no pixel) - 10 (no CAPI) = 50
      expect(result.overallScore).toBe(50);
    });

    it("clamps score to minimum 0", async () => {
      const mockAds: AdReviewStatus[] = [
        makeMockAdReviewStatus({ adId: "1", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "2", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "3", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "4", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "5", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "6", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "7", effectiveStatus: "DISAPPROVED" }),
        makeMockAdReviewStatus({ adId: "8", effectiveStatus: "DISAPPROVED" }),
      ];

      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue(mockAds);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      // Would be negative, should clamp to 0
      expect(result.overallScore).toBe(0);
    });

    it("clamps score to maximum 100", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ count_server: 100 }] }));

      const result = await auditor.audit("act_123");

      expect(result.overallScore).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------

  describe("recommendations", () => {
    it("recommends fixing disapproved ads", async () => {
      const mockAds: AdReviewStatus[] = [
        makeMockAdReviewStatus({ adId: "1", effectiveStatus: "DISAPPROVED" }),
      ];

      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue(mockAds);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.recommendations).toContain(
        "Review and fix disapproved ads to restore delivery",
      );
    });

    it("recommends addressing review feedback for ads with issues", async () => {
      const mockAds: AdReviewStatus[] = [
        makeMockAdReviewStatus({ adId: "1", effectiveStatus: "WITH_ISSUES" }),
      ];

      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue(mockAds);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.recommendations).toContain(
        "Address ad review feedback to prevent future disapprovals",
      );
    });

    it("recommends installing pixel when not healthy", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.recommendations).toContain(
        "Install and verify Meta Pixel for conversion tracking",
      );
    });

    it("recommends setting up CAPI when not configured", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result.recommendations).toContain(
        "Set up server-side event tracking via Conversions API",
      );
    });

    it("returns no recommendations when everything is healthy", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValueOnce(okResponse({ data: [{ count_server: 100 }] }));

      const result = await auditor.audit("act_123");

      expect(result.recommendations).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Audit metadata
  // -------------------------------------------------------------------------

  describe("audit metadata", () => {
    it("includes auditedAt timestamp", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock.mockResolvedValue(okResponse({ special_ad_categories: [], data: [] }));

      const before = new Date().toISOString();
      const result = await auditor.audit("act_123");
      const after = new Date().toISOString();

      expect(result.auditedAt).toBeDefined();
      expect(result.auditedAt >= before).toBe(true);
      expect(result.auditedAt <= after).toBe(true);
    });

    it("includes all required fields in result", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(okResponse({ data: [] }));

      const result = await auditor.audit("act_123");

      expect(result).toHaveProperty("accountId");
      expect(result).toHaveProperty("auditedAt");
      expect(result).toHaveProperty("disapprovedAds");
      expect(result).toHaveProperty("adsWithIssues");
      expect(result).toHaveProperty("specialAdCategoriesConfigured");
      expect(result).toHaveProperty("specialAdCategories");
      expect(result).toHaveProperty("pixelHealthy");
      expect(result).toHaveProperty("capiConfigured");
      expect(result).toHaveProperty("overallScore");
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("recommendations");
    });
  });

  // -------------------------------------------------------------------------
  // Fault tolerance
  // -------------------------------------------------------------------------

  describe("fault tolerance", () => {
    it("continues audit when special ad categories check fails", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      // All fetch calls fail
      fetchMock.mockResolvedValue(errorResponse("API error"));

      const result = await auditor.audit("act_123");

      // Audit completes with defaults for failed checks
      expect(result.specialAdCategoriesConfigured).toBe(false);
      expect(result.specialAdCategories).toEqual([]);
      expect(result.pixelHealthy).toBe(false);
      expect(result.capiConfigured).toBe(false);
    });

    it("continues audit when pixel health check fails", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValue(errorResponse("Pixel error"));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(false);
      expect(result.capiConfigured).toBe(false);
    });

    it("continues audit when CAPI check fails", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockResolvedValue([]);
      fetchMock
        .mockResolvedValueOnce(okResponse({ special_ad_categories: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { id: "pixel1", is_unavailable: false, last_fired_time: "2024-01-01T12:00:00Z" },
            ],
          }),
        )
        .mockResolvedValueOnce(okResponse({ data: [{ id: "pixel1" }] }))
        .mockResolvedValue(errorResponse("CAPI error"));

      const result = await auditor.audit("act_123");

      expect(result.pixelHealthy).toBe(true);
      expect(result.capiConfigured).toBe(false);
    });

    it("completes audit even when all checks fail", async () => {
      vi.spyOn(ReviewChecker.prototype, "checkReviewStatus").mockRejectedValue(
        new Error("Review check failed"),
      );
      fetchMock.mockResolvedValue(errorResponse("All checks failed"));

      const result = await auditor.audit("act_123");

      // Should return a complete result with all defaults
      expect(result.accountId).toBe("act_123");
      expect(result.disapprovedAds).toEqual([]);
      expect(result.adsWithIssues).toEqual([]);
      expect(result.specialAdCategoriesConfigured).toBe(false);
      expect(result.pixelHealthy).toBe(false);
      expect(result.capiConfigured).toBe(false);
      expect(result.overallScore).toBe(70); // 100 - 20 (pixel) - 10 (CAPI)
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });
});
