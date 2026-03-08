// ---------------------------------------------------------------------------
// Tests — CustomAudienceBuilder
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { CustomAudienceBuilder } from "../custom-audience-builder.js";

const BASE_URL = "https://graph.facebook.com/v21.0";
const TOKEN = "test-token";

describe("CustomAudienceBuilder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── create ────────────────────────────────────────────────────────

  it("creates a custom audience with website source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "aud_123" }),
      } as unknown as Response),
    );

    const builder = new CustomAudienceBuilder(BASE_URL, TOKEN);
    const result = await builder.create({
      adAccountId: "123456",
      name: "Website Visitors",
      description: "People who visited our site in the last 30 days",
      source: "website",
      retentionDays: 30,
      rule: { url: { i_contains: "example.com" } },
    });

    expect(result.id).toBe("aud_123");
    expect(result.name).toBe("Website Visitors");
    expect(result.subtype).toBe("WEBSITE");
    expect(result.retentionDays).toBe(30);
    expect(result.description).toBe("People who visited our site in the last 30 days");
    expect(result.createdAt).toBeDefined();

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0]).toContain("act_123456/customaudiences");
    expect(fetchCall[1]!.method).toBe("POST");
  });

  it("maps source to correct subtype", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "aud_456" }),
      } as unknown as Response),
    );

    const builder = new CustomAudienceBuilder(BASE_URL, TOKEN);

    // Test customer_list source
    const result = await builder.create({
      adAccountId: "act_123",
      name: "Customer List",
      source: "customer_list",
    });
    expect(result.subtype).toBe("CUSTOM");

    // Test engagement source
    const result2 = await builder.create({
      adAccountId: "act_123",
      name: "Engaged Users",
      source: "engagement",
    });
    expect(result2.subtype).toBe("ENGAGEMENT");

    // Test app source
    const result3 = await builder.create({
      adAccountId: "act_123",
      name: "App Users",
      source: "app",
    });
    expect(result3.subtype).toBe("APP");
  });

  it("throws on create failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: "Invalid parameters" } }),
      } as unknown as Response),
    );

    const builder = new CustomAudienceBuilder(BASE_URL, TOKEN);
    await expect(
      builder.create({
        adAccountId: "act_123",
        name: "Test",
        source: "website",
      }),
    ).rejects.toThrow("Failed to create custom audience: Invalid parameters");
  });

  // ── list ──────────────────────────────────────────────────────────

  it("lists audiences with pagination", async () => {
    const page1 = {
      data: [
        {
          id: "aud_1",
          name: "Audience 1",
          description: "First",
          subtype: "WEBSITE",
          approximate_count: 50000,
          delivery_status: { status: "ready" },
          retention_days: 30,
          time_created: "2025-01-01T00:00:00Z",
        },
      ],
      paging: { next: "https://graph.facebook.com/v21.0/page2" },
    };
    const page2 = {
      data: [
        {
          id: "aud_2",
          name: "Audience 2",
          subtype: "CUSTOM",
          approximate_count: 10000,
        },
      ],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page1),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page2),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const builder = new CustomAudienceBuilder(BASE_URL, TOKEN);
    const audiences = await builder.list("act_123456");

    expect(audiences).toHaveLength(2);
    expect(audiences[0]!.id).toBe("aud_1");
    expect(audiences[0]!.name).toBe("Audience 1");
    expect(audiences[0]!.subtype).toBe("WEBSITE");
    expect(audiences[0]!.approximateCount).toBe(50000);
    expect(audiences[0]!.deliveryStatus).toBe("ready");
    expect(audiences[0]!.retentionDays).toBe(30);
    expect(audiences[1]!.id).toBe("aud_2");
    expect(audiences[1]!.approximateCount).toBe(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── delete ────────────────────────────────────────────────────────

  it("deletes an audience", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as unknown as Response),
    );

    const builder = new CustomAudienceBuilder(BASE_URL, TOKEN);
    const result = await builder.delete("aud_123");

    expect(result.success).toBe(true);
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0]).toContain("aud_123");
    expect(fetchCall[1]!.method).toBe("DELETE");
  });

  it("throws on delete failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { message: "Audience not found" } }),
      } as unknown as Response),
    );

    const builder = new CustomAudienceBuilder(BASE_URL, TOKEN);
    await expect(builder.delete("aud_999")).rejects.toThrow(
      "Failed to delete audience: Audience not found",
    );
  });
});
