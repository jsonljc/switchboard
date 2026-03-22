import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProductSetManager } from "../product-sets.js";

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

describe("ProductSetManager", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let manager: ProductSetManager;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    manager = new ProductSetManager("https://graph.facebook.com/v22.0", "test-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // List product sets
  // -------------------------------------------------------------------------

  describe("list", () => {
    it("fetches all product sets for a catalog", async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          data: [
            {
              id: "set1",
              name: "Summer Collection",
              product_count: 150,
              filter: { brand: { eq: "BrandA" } },
            },
            {
              id: "set2",
              name: "Winter Collection",
              product_count: 200,
              filter: { category: { eq: "Apparel" } },
            },
          ],
        }),
      );

      const result = await manager.list("cat123");

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("set1");
      expect(result[0]!.name).toBe("Summer Collection");
      expect(result[0]!.productCount).toBe(150);
      expect(result[0]!.filter).toEqual({ brand: { eq: "BrandA" } });
    });

    it("handles empty product sets", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      const result = await manager.list("cat123");

      expect(result).toEqual([]);
    });

    it("handles missing optional fields", async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          data: [
            {
              id: "set1",
            },
          ],
        }),
      );

      const result = await manager.list("cat123");

      expect(result[0]!.id).toBe("set1");
      expect(result[0]!.name).toBe("");
      expect(result[0]!.productCount).toBe(0);
      expect(result[0]!.filter).toBeNull();
    });

    it("handles null filter", async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          data: [
            {
              id: "set1",
              name: "All Products",
              product_count: 500,
              filter: null,
            },
          ],
        }),
      );

      const result = await manager.list("cat123");

      expect(result[0]!.filter).toBeNull();
    });

    it("includes all required fields in request", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await manager.list("cat123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("fields=id,name,product_count,filter"),
      );
    });

    it("constructs correct URL with catalog ID", async () => {
      fetchMock.mockResolvedValue(okResponse({ data: [] }));

      await manager.list("cat123");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/cat123/product_sets"));
    });

    it("throws error on API failure", async () => {
      fetchMock.mockResolvedValue(errorResponse("Catalog not found", 404));

      await expect(manager.list("cat123")).rejects.toThrow("Meta API error");
    });

    it("includes error message from API response", async () => {
      fetchMock.mockResolvedValue(errorResponse("Invalid access token"));

      await expect(manager.list("cat123")).rejects.toThrow("Invalid access token");
    });
  });

  // -------------------------------------------------------------------------
  // Create product set
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("creates a new product set", async () => {
      const filter = { brand: { eq: "BrandA" }, price: { gt: 100 } };

      fetchMock.mockResolvedValue(okResponse({ id: "newset123" }));

      const result = await manager.create("cat123", {
        name: "Premium Collection",
        filter,
      });

      expect(result.id).toBe("newset123");
      expect(result.name).toBe("Premium Collection");
      expect(result.productCount).toBe(0);
      expect(result.filter).toEqual(filter);
    });

    it("sends POST request with correct body", async () => {
      const filter = { category: { eq: "Electronics" } };

      fetchMock.mockResolvedValue(okResponse({ id: "newset456" }));

      await manager.create("cat123", {
        name: "Electronics",
        filter,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/cat123/product_sets"),
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Electronics",
            filter,
          }),
        }),
      );
    });

    it("handles empty filter", async () => {
      fetchMock.mockResolvedValue(okResponse({ id: "newset789" }));

      const result = await manager.create("cat123", {
        name: "All Products",
        filter: {},
      });

      expect(result.filter).toEqual({});
    });

    it("handles complex nested filters", async () => {
      const complexFilter = {
        and: [
          { brand: { eq: "BrandA" } },
          { price: { gt: 50, lt: 200 } },
          { availability: { eq: "in stock" } },
        ],
      };

      fetchMock.mockResolvedValue(okResponse({ id: "complex123" }));

      const result = await manager.create("cat123", {
        name: "Complex Set",
        filter: complexFilter,
      });

      expect(result.filter).toEqual(complexFilter);
    });

    it("constructs correct URL with catalog ID", async () => {
      fetchMock.mockResolvedValue(okResponse({ id: "newset" }));

      await manager.create("cat456", {
        name: "Test Set",
        filter: {},
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/cat456/product_sets"),
        expect.anything(),
      );
    });

    it("includes access token in URL", async () => {
      fetchMock.mockResolvedValue(okResponse({ id: "newset" }));

      await manager.create("cat123", {
        name: "Test Set",
        filter: {},
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("access_token=test-token"),
        expect.anything(),
      );
    });

    it("throws error on API failure", async () => {
      fetchMock.mockResolvedValue(errorResponse("Invalid filter syntax", 400));

      await expect(
        manager.create("cat123", {
          name: "Invalid Set",
          filter: { invalid: "filter" },
        }),
      ).rejects.toThrow("Meta API error");
    });

    it("includes error message from API response", async () => {
      fetchMock.mockResolvedValue(errorResponse("Duplicate product set name"));

      await expect(
        manager.create("cat123", {
          name: "Duplicate",
          filter: {},
        }),
      ).rejects.toThrow("Duplicate product set name");
    });

    it("handles malformed JSON responses on error", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error("Invalid JSON")),
      } as unknown as Response);

      await expect(
        manager.create("cat123", {
          name: "Test",
          filter: {},
        }),
      ).rejects.toThrow();
    });

    it("handles HTTP 500 errors", async () => {
      fetchMock.mockResolvedValue(errorResponse("Internal server error", 500));

      await expect(
        manager.create("cat123", {
          name: "Test",
          filter: {},
        }),
      ).rejects.toThrow("Meta API error");
    });
  });

  // -------------------------------------------------------------------------
  // Result format
  // -------------------------------------------------------------------------

  describe("result format", () => {
    it("list returns array of ProductSet objects", async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          data: [
            {
              id: "set1",
              name: "Test Set",
              product_count: 100,
              filter: { brand: { eq: "Test" } },
            },
          ],
        }),
      );

      const result = await manager.list("cat123");

      expect(Array.isArray(result)).toBe(true);
      const productSet = result[0]!;
      expect(productSet).toHaveProperty("id");
      expect(productSet).toHaveProperty("name");
      expect(productSet).toHaveProperty("productCount");
      expect(productSet).toHaveProperty("filter");
    });

    it("create returns ProductSet object", async () => {
      fetchMock.mockResolvedValue(okResponse({ id: "newset" }));

      const result = await manager.create("cat123", {
        name: "Test",
        filter: {},
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("productCount");
      expect(result).toHaveProperty("filter");
    });

    it("create initializes productCount to 0", async () => {
      fetchMock.mockResolvedValue(okResponse({ id: "newset" }));

      const result = await manager.create("cat123", {
        name: "Test",
        filter: {},
      });

      expect(result.productCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("handles network errors on list", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));

      await expect(manager.list("cat123")).rejects.toThrow("Network error");
    });

    it("handles network errors on create", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));

      await expect(
        manager.create("cat123", {
          name: "Test",
          filter: {},
        }),
      ).rejects.toThrow("Network error");
    });

    it("handles missing error object in API response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({}),
      } as unknown as Response);

      await expect(manager.list("cat123")).rejects.toThrow("HTTP 400");
    });

    it("handles missing message in error object", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { type: "OAuthException" } }),
      } as unknown as Response);

      await expect(manager.list("cat123")).rejects.toThrow("HTTP 403");
    });
  });

  // -------------------------------------------------------------------------
  // Type safety
  // -------------------------------------------------------------------------

  describe("type safety", () => {
    it("accepts various filter structures", async () => {
      fetchMock.mockResolvedValue(okResponse({ id: "newset" }));

      // Simple filter
      await manager.create("cat123", {
        name: "Simple",
        filter: { brand: { eq: "Test" } },
      });

      // Nested filter
      await manager.create("cat123", {
        name: "Nested",
        filter: { and: [{ brand: { eq: "A" } }, { price: { gt: 100 } }] },
      });

      // Empty filter
      await manager.create("cat123", {
        name: "Empty",
        filter: {},
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("preserves filter structure through create", async () => {
      const complexFilter = {
        or: [
          { and: [{ brand: { eq: "A" } }, { price: { lt: 50 } }] },
          { category: { in: ["electronics", "accessories"] } },
        ],
      };

      fetchMock.mockResolvedValue(okResponse({ id: "newset" }));

      const result = await manager.create("cat123", {
        name: "Complex",
        filter: complexFilter,
      });

      expect(result.filter).toEqual(complexFilter);
    });
  });
});
