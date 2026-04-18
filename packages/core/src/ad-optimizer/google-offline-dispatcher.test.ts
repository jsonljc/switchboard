import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleOfflineDispatcher } from "./google-offline-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: "calendar-book",
    metadata: { gclid: "gclid_abc123" },
    ...overrides,
  };
}

describe("GoogleOfflineDispatcher", () => {
  let uploadFn: ReturnType<typeof vi.fn>;
  let dispatcher: GoogleOfflineDispatcher;

  beforeEach(() => {
    uploadFn = vi.fn().mockResolvedValue({ accepted: true });
    dispatcher = new GoogleOfflineDispatcher(
      {
        customerId: "cust_1",
        conversionActionMapping: {
          booked: "customers/1/conversionActions/100",
          purchased: "customers/1/conversionActions/200",
        },
      },
      uploadFn,
    );
  });

  it("platform is 'google_offline'", () => {
    expect(dispatcher.platform).toBe("google_offline");
  });

  it("canDispatch returns true when gclid present and mapping exists", () => {
    expect(dispatcher.canDispatch(makeEvent())).toBe(true);
  });

  it("canDispatch returns false without gclid", () => {
    expect(dispatcher.canDispatch(makeEvent({ metadata: {} }))).toBe(false);
  });

  it("canDispatch returns false when no mapping for event type", () => {
    expect(dispatcher.canDispatch(makeEvent({ type: "inquiry" }))).toBe(false);
  });

  it("dispatch calls upload function with correct params", async () => {
    const result = await dispatcher.dispatch(makeEvent());
    expect(result.accepted).toBe(true);
    expect(uploadFn).toHaveBeenCalledWith({
      gclid: "gclid_abc123",
      conversionDateTime: "2026-04-20T10:00:00.000Z",
      conversionValue: 100,
      currencyCode: "SGD",
      conversionAction: "customers/1/conversionActions/100",
    });
  });

  it("dispatch returns error from upload function", async () => {
    uploadFn.mockResolvedValue({ accepted: false, errorMessage: "Invalid gclid" });
    const result = await dispatcher.dispatch(makeEvent());
    expect(result.accepted).toBe(false);
    expect(result.errorMessage).toBe("Invalid gclid");
  });
});
