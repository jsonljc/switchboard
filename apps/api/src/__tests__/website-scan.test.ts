import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import * as dns from "node:dns/promises";
import websiteScanRoutes from "../routes/website-scan.js";

// Drive the REAL ssrf-guard end-to-end by mocking only DNS resolution (mirrors
// ssrf-guard.test.ts). This proves the route actually re-runs the guard on each
// redirect hop, rather than mocking the guard away.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockLookup = vi.mocked(dns.lookup);

/** Minimal Response-shaped stub for a 3xx redirect with a Location header. */
function redirectResponse(location: string, status = 302) {
  return {
    status,
    ok: false,
    headers: { get: (name: string) => (name.toLowerCase() === "location" ? location : null) },
    text: async () => "",
  };
}

/** Minimal Response-shaped stub for a terminal 200 page. */
function okResponse(text: string) {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: async () => text,
  };
}

describe("POST /api/website-scan", () => {
  let app: FastifyInstance;
  const fetchSpy = vi.fn();

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Stub organizationIdFromAuth on every request
    app.decorateRequest("organizationIdFromAuth", undefined as unknown as string);
    app.addHook("preHandler", async (request) => {
      const orgHeader = request.headers["x-organization-id"];
      if (typeof orgHeader === "string") {
        request.organizationIdFromAuth = orgHeader;
      }
    });

    await app.register(websiteScanRoutes);

    vi.stubGlobal(
      "fetch",
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () =>
          "<html><body>Test page with enough content to pass the length check. ".repeat(10) +
          "</body></html>",
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
    mockLookup.mockReset();
    await app.close();
  });

  it("rejects localhost URLs before attempting fetch", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "https://localhost/internal" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS URLs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "http://example.com" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("HTTPS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("follows a public https redirect and reads the final page", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as never);
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(redirectResponse("https://www.example.com/final"))
      // terminal page is intentionally short so the route returns before the LLM call
      .mockResolvedValueOnce(okResponse("<html><body>Hi</body></html>"));

    const response = await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "https://example.com/start" },
    });

    expect(response.statusCode).toBe(200);
    // the redirect was followed: a SECOND fetch was issued to the Location target
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://www.example.com/final");
    // followed manually so the guard re-validates every hop
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    // the body reflects the FINAL page (short-content warning), proving the hop landed
    expect(response.json().warning).toBeDefined();
  });

  it("blocks a redirect to a private/link-local host without fetching it", async () => {
    mockLookup.mockImplementation((async (hostname: unknown) => {
      if (hostname === "blocked.internal") {
        return { address: "169.254.169.254", family: 4 }; // cloud-metadata / link-local
      }
      return { address: "93.184.216.34", family: 4 }; // public
    }) as never);
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(redirectResponse("https://blocked.internal/latest/meta-data"))
      .mockResolvedValue(okResponse("<html><body>internal secrets</body></html>"));

    const response = await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "https://example.com/start" },
    });

    expect(response.statusCode).toBe(200);
    // safe generic error; the internal response body is never surfaced
    expect(response.json().error).toContain("Scan failed");
    expect(response.json().result).toEqual({ services: [], contactMethods: [], faqHints: [] });
    // only the public origin was fetched; the private target was NOT
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain("blocked.internal");
    }
    // the private redirect target was run through the SSRF guard (and blocked)
    expect(mockLookup).toHaveBeenCalledWith("blocked.internal");
  });

  it("uses manual redirect handling so the guard sees every hop", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as never);
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(okResponse("<html><body>Hi</body></html>"));

    await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "https://example.com/start" },
    });

    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      expect(call[1]).toMatchObject({ redirect: "manual" });
    }
  });

  it("stops after the redirect cap and returns a safe error", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as never);
    fetchSpy.mockReset();
    // every hop redirects again -> an over-long public redirect chain
    fetchSpy.mockResolvedValue(redirectResponse("https://example.com/loop"));

    const response = await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "https://example.com/start" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().error).toContain("Scan failed");
    // 1 initial + MAX_REDIRECTS (5) follows = 6 fetches, then the chain is capped
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});
