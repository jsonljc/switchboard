import { describe, it, expect, vi, beforeEach } from "vitest";
import { wireCAPIDispatcher } from "../conversion-bus-wiring.js";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";

// Mock fetch to intercept CAPI calls
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ events_received: 1 }),
});
vi.stubGlobal("fetch", mockFetch);

describe("wireCAPIDispatcher", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("sends Purchase event to Meta CAPI when purchased event emitted", async () => {
    const bus = new InMemoryConversionBus();
    wireCAPIDispatcher(bus, { pixelId: "px-123", accessToken: "token-abc" });

    const event: ConversionEvent = {
      type: "purchased",
      contactId: "c1",
      organizationId: "org-1",
      value: 388,
      sourceAdId: "ad-456",
      sourceCampaignId: "camp-789",
      timestamp: new Date("2026-04-14T10:00:00Z"),
      metadata: {},
    };

    bus.emit(event);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("px-123/events");
    const body = JSON.parse(opts.body);
    expect(body.data[0].event_name).toBe("Purchase");
    expect(body.data[0].custom_data.value).toBe(388);
  });

  it("skips events without sourceAdId", async () => {
    const bus = new InMemoryConversionBus();
    wireCAPIDispatcher(bus, { pixelId: "px-123", accessToken: "token-abc" });

    bus.emit({
      type: "purchased",
      contactId: "c1",
      organizationId: "org-1",
      value: 100,
      timestamp: new Date(),
      metadata: {},
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends Lead event for non-purchased types", async () => {
    const bus = new InMemoryConversionBus();
    wireCAPIDispatcher(bus, { pixelId: "px-123", accessToken: "token-abc" });

    bus.emit({
      type: "inquiry",
      contactId: "c1",
      organizationId: "org-1",
      value: 0,
      sourceAdId: "ad-1",
      timestamp: new Date(),
      metadata: {},
    });

    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.data[0].event_name).toBe("Lead");
  });
});
