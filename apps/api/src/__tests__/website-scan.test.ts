import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import websiteScanRoutes from "../routes/website-scan.js";

describe("POST /api/website-scan", () => {
  let app: FastifyInstance;
  const fetchSpy = vi.fn();

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Stub organizationIdFromAuth on every request
    app.decorateRequest("organizationIdFromAuth", null);
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
});
