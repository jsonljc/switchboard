import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import { HttpPlatformIngressAdapter } from "./http-platform-ingress-adapter.js";

const REQUEST = {
  organizationId: "org_a",
  actor: { id: "wa:+65", type: "user" },
  intent: "alex.respond",
  parameters: {},
  trigger: "chat",
  surface: { surface: "chat" },
} as unknown as CanonicalSubmitRequest;

describe("HttpPlatformIngressAdapter", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {}, workUnit: {} }), { status: 200 }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to the internal ingress path with the Bearer secret", async () => {
    const adapter = new HttpPlatformIngressAdapter("http://api:3000", "s3cr3t");
    await adapter.submit(REQUEST);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api:3000/api/internal/ingress/submit");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer s3cr3t");
  });

  it("omits the Authorization header when no secret is set", async () => {
    const adapter = new HttpPlatformIngressAdapter("http://api:3000", undefined);
    await adapter.submit(REQUEST);
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("returns a validation_failed error on a 4xx response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("nope", { status: 401 }));
    const adapter = new HttpPlatformIngressAdapter("http://api:3000", "s3cr3t");
    const res = await adapter.submit(REQUEST);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.type).toBe("validation_failed");
  });
});
