import { describe, it, expect, vi } from "vitest";
import { probeWhatsAppHealth } from "../whatsapp-health-probe.js";

describe("probeWhatsAppHealth", () => {
  it("calls graph.facebook.com/<apiVersion>/<phoneNumberId> with Bearer <userToken>", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "phone_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await probeWhatsAppHealth({
      apiVersion: "v17.0",
      userToken: "CUSTOMER_TOKEN",
      phoneNumberId: "PHONE_1",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v17.0/PHONE_1");
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer CUSTOMER_TOKEN");
  });

  it("honors the apiVersion parameter (no hardcoded version)", async () => {
    const calls: Array<{ url: string }> = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push({ url });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await probeWhatsAppHealth({
      apiVersion: "v21.0",
      userToken: "T",
      phoneNumberId: "P",
      fetchImpl,
    });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/P");
  });

  it("returns ok=false with reason on non-2xx", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("forbidden", { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await probeWhatsAppHealth({
      apiVersion: "v17.0",
      userToken: "T",
      phoneNumberId: "P",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("401");
    }
  });

  it("returns ok=false with reason on thrown error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await probeWhatsAppHealth({
      apiVersion: "v17.0",
      userToken: "T",
      phoneNumberId: "P",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ECONNREFUSED");
    }
  });
});
