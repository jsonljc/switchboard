import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebhookHandler } from "../dispatch/webhook-handler.js";
import { createEventEnvelope } from "../events.js";
import { createHmac } from "node:crypto";

describe("createWebhookHandler", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("POSTs event payload with HMAC signature", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const configs = new Map([
      [
        "hook-1",
        {
          id: "hook-1",
          url: "https://example.com/webhook",
          secret: "test-secret",
          subscribedEvents: ["lead.received"],
          criticality: "required" as const,
          enabled: true,
        },
      ],
    ]);

    const handler = createWebhookHandler({ getConfigs: () => configs, fetchFn: mockFetch });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "agent", id: "lead-responder" },
      payload: { contactId: "c1" },
    });

    const result = await handler(event, "hook-1");
    expect(result.success).toBe(true);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.com/webhook");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["X-Switchboard-Event"]).toBe("lead.received");

    // Verify HMAC signature
    const bodyStr = options.body;
    const expectedSig = createHmac("sha256", "test-secret").update(bodyStr).digest("hex");
    expect(options.headers["X-Switchboard-Signature"]).toBe(expectedSig);
  });

  it("returns failure when webhook config not found", async () => {
    const handler = createWebhookHandler({
      getConfigs: () => new Map(),
      fetchFn: mockFetch,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await handler(event, "nonexistent");
    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns failure when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const configs = new Map([
      [
        "hook-1",
        {
          id: "hook-1",
          url: "https://example.com/webhook",
          secret: "test-secret",
          subscribedEvents: ["lead.received"],
          criticality: "required" as const,
          enabled: true,
        },
      ],
    ]);

    const handler = createWebhookHandler({ getConfigs: () => configs, fetchFn: mockFetch });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await handler(event, "hook-1");
    expect(result.success).toBe(false);
  });

  it("returns failure when response is not ok", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const configs = new Map([
      [
        "hook-1",
        {
          id: "hook-1",
          url: "https://example.com/webhook",
          secret: "test-secret",
          subscribedEvents: ["lead.received"],
          criticality: "required" as const,
          enabled: true,
        },
      ],
    ]);

    const handler = createWebhookHandler({ getConfigs: () => configs, fetchFn: mockFetch });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await handler(event, "hook-1");
    expect(result.success).toBe(false);
  });
});
