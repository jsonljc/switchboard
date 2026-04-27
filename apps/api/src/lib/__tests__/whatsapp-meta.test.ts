import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerWebhookOverride, fetchWabaIdFromToken } from "../whatsapp-meta.js";

describe("whatsapp-meta helper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("registerWebhookOverride", () => {
    it("calls /<wabaId>/subscribed_apps with the customer userToken (NOT the appToken)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      const result = await registerWebhookOverride({
        apiVersion: "v17.0",
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "verify-secret",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(result.ok).toBe(true);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toContain("/WABA_1/subscribed_apps");
      expect((init as { method: string }).method).toBe("POST");
      expect((init as { headers: Record<string, string> }).headers["Authorization"]).toBe(
        "Bearer CUSTOMER_TOKEN",
      );
    });

    it("sends override_callback_uri and verify_token in the request body", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      await registerWebhookOverride({
        apiVersion: "v17.0",
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "verify-secret",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [, init] = fetchSpy.mock.calls[0]!;
      const body = JSON.parse((init as { body: string }).body);
      expect(body.override_callback_uri).toBe("https://chat.example.com/webhook/managed/conn_1");
      expect(body.verify_token).toBe("verify-secret");
    });

    it("returns ok=false with error.message when Meta returns non-2xx", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad token" } }),
      });
      const result = await registerWebhookOverride({
        apiVersion: "v17.0",
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "v",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("bad token");
      }
    });

    it("uses the apiVersion provided by the caller (v17.0)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      await registerWebhookOverride({
        apiVersion: "v17.0",
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "verify-secret",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toContain("/v17.0/");
      expect(url).not.toContain("v21.0");
    });

    it("uses the apiVersion provided by the caller (v21.0)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      await registerWebhookOverride({
        apiVersion: "v21.0",
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "verify-secret",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toContain("/v21.0/");
      expect(url).not.toContain("v17.0");
    });

    it("auth shape: uses Authorization: Bearer <userToken> header and NO access_token query param", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      await registerWebhookOverride({
        apiVersion: "v17.0",
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "verify-secret",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [url, init] = fetchSpy.mock.calls[0]!;
      const headers = (init as { headers: Record<string, string> }).headers;
      expect(headers["Authorization"]).toBe("Bearer CUSTOMER_TOKEN");
      expect(String(url)).not.toContain("access_token=");
    });
  });

  describe("fetchWabaIdFromToken", () => {
    it("calls /debug_token with userToken as input_token and appToken as access_token", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_42"] }],
          },
        }),
      });
      const result = await fetchWabaIdFromToken({
        apiVersion: "v17.0",
        appToken: "APP_TOKEN",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.wabaId).toBe("WABA_42");
      }
      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toContain("input_token=CUSTOMER_TOKEN");
      expect(url).toContain("access_token=APP_TOKEN");
    });

    it("returns ok=false when Meta returns non-2xx", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "invalid token" } }),
      });
      const result = await fetchWabaIdFromToken({
        apiVersion: "v17.0",
        appToken: "APP_TOKEN",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("invalid token");
      }
    });

    it("returns ok=false when granular_scopes is missing or empty", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { granular_scopes: [] } }),
      });
      const result = await fetchWabaIdFromToken({
        apiVersion: "v17.0",
        appToken: "APP_TOKEN",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
    });

    it("returns ok=false when no whatsapp_business_management scope has a target_id", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            granular_scopes: [{ scope: "business_management", target_ids: [] }],
          },
        }),
      });
      const result = await fetchWabaIdFromToken({
        apiVersion: "v17.0",
        appToken: "APP_TOKEN",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
    });

    it("URL-encodes both tokens", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_1"] }],
          },
        }),
      });
      await fetchWabaIdFromToken({
        apiVersion: "v17.0",
        appToken: "APP TOKEN/with+special",
        userToken: "USER TOKEN&more",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toContain(encodeURIComponent("APP TOKEN/with+special"));
      expect(url).toContain(encodeURIComponent("USER TOKEN&more"));
    });

    it("uses the apiVersion provided by the caller (v17.0)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_1"] }],
          },
        }),
      });
      await fetchWabaIdFromToken({
        apiVersion: "v17.0",
        appToken: "APP_TOKEN",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [url] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain("/v17.0/debug_token");
      expect(String(url)).not.toContain("v21.0");
    });

    it("uses the apiVersion provided by the caller (v21.0)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_1"] }],
          },
        }),
      });
      await fetchWabaIdFromToken({
        apiVersion: "v21.0",
        appToken: "APP_TOKEN",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [url] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain("/v21.0/debug_token");
      expect(String(url)).not.toContain("v17.0");
    });

    it("auth shape: passes appToken via access_token query param and sends NO Authorization header", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA_1"] }],
          },
        }),
      });
      await fetchWabaIdFromToken({
        apiVersion: "v17.0",
        appToken: "APP_TOKEN_123",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain("access_token=APP_TOKEN_123");
      // No init at all is acceptable (default GET) — assert no Authorization header if init present.
      const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
      if (headers) {
        expect(headers["Authorization"]).toBeUndefined();
      }
    });
  });
});
