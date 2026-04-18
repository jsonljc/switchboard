import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaCAPIDispatcher } from "./meta-capi-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    sourceAdId: "ad_123",
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: "calendar-book",
    metadata: { fbclid: "fb.1.123.abc" },
    ...overrides,
  };
}

describe("MetaCAPIDispatcher", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let dispatcher: MetaCAPIDispatcher;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events_received: 1 }),
    });
    dispatcher = new MetaCAPIDispatcher(
      { pixelId: "px_1", accessToken: "tok_1" },
      fetchMock as never,
    );
  });

  it("platform is 'meta_capi'", () => {
    expect(dispatcher.platform).toBe("meta_capi");
  });

  it("canDispatch returns true when sourceAdId is present", () => {
    expect(dispatcher.canDispatch(makeEvent())).toBe(true);
  });

  it("canDispatch returns true when fbclid is in metadata", () => {
    expect(dispatcher.canDispatch(makeEvent({ sourceAdId: undefined }))).toBe(true);
  });

  it("canDispatch returns false when no ad attribution", () => {
    expect(dispatcher.canDispatch(makeEvent({ sourceAdId: undefined, metadata: {} }))).toBe(false);
  });

  it("dispatch sends to Graph API and returns accepted", async () => {
    const result = await dispatcher.dispatch(makeEvent());
    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/px_1/events",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("dispatch returns rejected on HTTP error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    });

    const result = await dispatcher.dispatch(makeEvent());
    expect(result.accepted).toBe(false);
    expect(result.errorMessage).toContain("400");
  });
});
