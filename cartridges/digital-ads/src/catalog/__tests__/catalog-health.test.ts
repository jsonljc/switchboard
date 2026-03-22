import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CatalogHealthChecker } from "../catalog-health.js";

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

describe("CatalogHealthChecker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let checker: CatalogHealthChecker;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    checker = new CatalogHealthChecker("https://graph.facebook.com/v22.0", "test-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic catalog info
  // -------------------------------------------------------------------------

  describe("basic catalog info", () => {
    it("fetches catalog name and product count", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            id: "cat123",
            name: "My Catalog",
            product_count: 1000,
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.catalogId).toBe("cat123");
      expect(result.catalogName).toBe("My Catalog");
      expect(result.totalProducts).toBe(1000);
    });

    it("handles missing catalog name", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            id: "cat123",
            product_count: 500,
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.catalogName).toBe("");
    });

    it("handles zero products", async () => {
      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            id: "cat123",
            name: "Empty Catalog",
            product_count: 0,
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.totalProducts).toBe(0);
      expect(result.errorRate).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  describe("diagnostics", () => {
    it("fetches and processes diagnostics", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { type: "missing_title", num_items: 10, severity: "warning" },
              { type: "invalid_price", num_items: 5, severity: "error" },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics[0]!.type).toBe("missing_title");
      expect(result.diagnostics[0]!.count).toBe(10);
      expect(result.diagnostics[0]!.severity).toBe("warning");
    });

    it("handles missing diagnostics endpoint", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockRejectedValueOnce(new Error("Diagnostics not available"))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.diagnostics).toEqual([]);
    });

    it("handles empty diagnostics", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.diagnostics).toEqual([]);
    });

    it("adds issues for critical diagnostics", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(
          okResponse({
            data: [{ type: "invalid_data", num_items: 15, severity: "critical" }],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.issues.some((issue) => issue.includes("invalid_data"))).toBe(true);
      expect(result.issues.some((issue) => issue.includes("critical"))).toBe(true);
    });

    it("adds issues for error diagnostics", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(
          okResponse({
            data: [{ type: "missing_field", num_items: 20, severity: "error" }],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.issues.some((issue) => issue.includes("missing_field"))).toBe(true);
    });

    it("does not add issues for info/warning diagnostics", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { type: "low_quality_image", num_items: 10, severity: "info" },
              { type: "missing_optional_field", num_items: 5, severity: "warning" },
            ],
          }),
        )
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.issues).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Product review status
  // -------------------------------------------------------------------------

  describe("product review status", () => {
    it("counts approved, rejected, and pending products", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 10 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [
              { review_status: "approved" },
              { review_status: "approved" },
              { review_status: "approved" },
              { review_status: "approved" },
              { review_status: "approved" },
              { review_status: "rejected" },
              { review_status: "rejected" },
              { review_status: "pending" },
              { review_status: "pending" },
              { review_status: "pending" },
            ],
          }),
        );

      const result = await checker.check("cat123");

      expect(result.approvedProducts).toBe(5);
      expect(result.rejectedProducts).toBe(2);
      expect(result.pendingProducts).toBe(3);
    });

    it("treats missing review_status as pending", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 3 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: [{ review_status: "approved" }, {}, { review_status: null }],
          }),
        );

      const result = await checker.check("cat123");

      expect(result.approvedProducts).toBe(1);
      expect(result.pendingProducts).toBe(2);
    });

    it("extrapolates counts when fetching subset of products", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, (_, i) => ({
              review_status: i < 80 ? "approved" : i < 90 ? "rejected" : "pending",
            })),
          }),
        );

      const result = await checker.check("cat123");

      // 100 products fetched, 1000 total -> 10x ratio
      // 80 approved -> 800
      // 10 rejected -> 100
      // 10 pending -> 100
      expect(result.approvedProducts).toBe(800);
      expect(result.rejectedProducts).toBe(100);
      expect(result.pendingProducts).toBe(100);
    });

    it("does not extrapolate when all products fetched", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 50 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 50 }, () => ({ review_status: "approved" })),
          }),
        );

      const result = await checker.check("cat123");

      expect(result.approvedProducts).toBe(50);
      expect(result.rejectedProducts).toBe(0);
      expect(result.pendingProducts).toBe(0);
    });

    it("handles negative pending count after extrapolation", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, () => ({ review_status: "approved" })),
          }),
        );

      const result = await checker.check("cat123");

      // All 100 approved -> 1000 approved (extrapolated)
      // Pending should be max(0, 1000 - 1000 - 0) = 0
      expect(result.pendingProducts).toBeGreaterThanOrEqual(0);
    });

    it("falls back to total count if products fetch fails", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 500 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockRejectedValueOnce(new Error("Products API error"));

      const result = await checker.check("cat123");

      expect(result.approvedProducts).toBe(500);
      expect(result.rejectedProducts).toBe(0);
      expect(result.pendingProducts).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error rate calculation
  // -------------------------------------------------------------------------

  describe("error rate calculation", () => {
    it("calculates error rate correctly", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, (_, i) => ({
              review_status: i < 95 ? "approved" : "rejected",
            })),
          }),
        );

      const result = await checker.check("cat123");

      // 50 rejected out of 1000 = 0.05 (5%)
      expect(result.errorRate).toBeCloseTo(0.05, 4);
    });

    it("handles zero products", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 0 }))
        .mockResolvedValue(okResponse({ data: [] }));

      const result = await checker.check("cat123");

      expect(result.errorRate).toBe(0);
    });

    it("rounds error rate to 4 decimal places", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 7 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 7 }, (_, i) => ({
              review_status: i < 6 ? "approved" : "rejected",
            })),
          }),
        );

      const result = await checker.check("cat123");

      // 1/7 = 0.142857... -> 0.1429
      expect(Number.isInteger(result.errorRate * 10000)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Issues and recommendations
  // -------------------------------------------------------------------------

  describe("issues and recommendations", () => {
    it("adds issue for rejected products", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, (_, i) => ({
              review_status: i < 90 ? "approved" : "rejected",
            })),
          }),
        );

      const result = await checker.check("cat123");

      expect(result.issues.some((issue) => issue.includes("10 product(s) are rejected"))).toBe(
        true,
      );
      expect(result.recommendations.some((rec) => rec.includes("fix data quality issues"))).toBe(
        true,
      );
    });

    it("adds issue for many pending products (>10%)", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, (_, i) => ({
              review_status: i < 70 ? "approved" : "pending",
            })),
          }),
        );

      const result = await checker.check("cat123");

      expect(result.issues.some((issue) => issue.includes("30 product(s) are pending"))).toBe(true);
      expect(
        result.recommendations.some((rec) => rec.includes("feed is properly configured")),
      ).toBe(true);
    });

    it("does not add issue for few pending products (<10%)", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, (_, i) => ({
              review_status: i < 95 ? "approved" : "pending",
            })),
          }),
        );

      const result = await checker.check("cat123");

      expect(result.issues.some((issue) => issue.includes("pending"))).toBe(false);
    });

    it("recommends validation tool when error rate > 5%", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, (_, i) => ({
              review_status: i < 90 ? "approved" : "rejected",
            })),
          }),
        );

      const result = await checker.check("cat123");

      expect(result.recommendations.some((rec) => rec.includes("feed validation tool"))).toBe(true);
    });

    it("returns good health message when no issues", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, () => ({ review_status: "approved" })),
          }),
        );

      const result = await checker.check("cat123");

      expect(result.issues).toEqual([]);
      expect(result.recommendations).toContain("Catalog health is good. No issues detected.");
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws error on catalog info fetch failure", async () => {
      fetchMock.mockResolvedValue(errorResponse("Catalog not found", 404));

      await expect(checker.check("cat123")).rejects.toThrow("Meta API error");
    });

    it("includes error message from API response", async () => {
      fetchMock.mockResolvedValue(errorResponse("Invalid access token"));

      await expect(checker.check("cat123")).rejects.toThrow("Invalid access token");
    });

    it("handles malformed JSON responses", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error("Invalid JSON")),
      } as unknown as Response);

      await expect(checker.check("cat123")).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Result format
  // -------------------------------------------------------------------------

  describe("result format", () => {
    it("includes all required fields", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, () => ({ review_status: "approved" })),
          }),
        );

      const result = await checker.check("cat123");

      expect(result).toHaveProperty("catalogId");
      expect(result).toHaveProperty("catalogName");
      expect(result).toHaveProperty("totalProducts");
      expect(result).toHaveProperty("approvedProducts");
      expect(result).toHaveProperty("rejectedProducts");
      expect(result).toHaveProperty("pendingProducts");
      expect(result).toHaveProperty("errorRate");
      expect(result).toHaveProperty("diagnostics");
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("recommendations");
    });

    it("formats percentage strings correctly", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValueOnce(
          okResponse({
            data: Array.from({ length: 100 }, (_, i) => ({
              review_status: i < 93 ? "approved" : "rejected",
            })),
          }),
        );

      const result = await checker.check("cat123");

      const issue = result.issues.find((i) => i.includes("%"));
      expect(issue).toContain("7.0%");
    });
  });

  // -------------------------------------------------------------------------
  // API request format
  // -------------------------------------------------------------------------

  describe("API request format", () => {
    it("includes required fields in catalog request", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await checker.check("cat123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("fields=id,name,product_count"),
      );
    });

    it("includes limit parameter in products request", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 1000 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValue(okResponse({ data: [] }));

      await checker.check("cat123");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("limit=500"));
    });

    it("includes review fields in products request", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse({ id: "cat123", name: "Catalog", product_count: 100 }))
        .mockResolvedValueOnce(okResponse({ data: [] }))
        .mockResolvedValue(okResponse({ data: [] }));

      await checker.check("cat123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("fields=review_status,errors"),
      );
    });
  });
});
