import { describe, it, expect, vi } from "vitest";
import { wireAdDispatchers } from "./wire-ad-dispatchers.js";
import { InMemoryConversionBus } from "../events/conversion-bus.js";
import type { ConversionEvent } from "../events/conversion-bus.js";
import type { AdConversionDispatcher } from "./ad-conversion-dispatcher.js";

function makeEvent(): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    occurredAt: new Date(),
    source: "test",
    metadata: { fbclid: "fb123" },
  };
}

describe("wireAdDispatchers", () => {
  it("dispatches to matching dispatchers and logs results", async () => {
    const bus = new InMemoryConversionBus();
    const dispatcher: AdConversionDispatcher = {
      platform: "meta_capi",
      canDispatch: vi.fn().mockReturnValue(true),
      dispatch: vi.fn().mockResolvedValue({ accepted: true, responsePayload: { ok: true } }),
    };
    const logStore = { record: vi.fn().mockResolvedValue({}) };

    wireAdDispatchers(bus, [dispatcher], logStore as never);
    bus.emit(makeEvent());

    await new Promise((r) => setTimeout(r, 50));

    expect(dispatcher.dispatch).toHaveBeenCalled();
    expect(logStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "meta_capi", status: "accepted" }),
    );
  });

  it("skips dispatchers that cannot dispatch", async () => {
    const bus = new InMemoryConversionBus();
    const dispatcher: AdConversionDispatcher = {
      platform: "google_offline",
      canDispatch: vi.fn().mockReturnValue(false),
      dispatch: vi.fn(),
    };
    const logStore = { record: vi.fn() };

    wireAdDispatchers(bus, [dispatcher], logStore as never);
    bus.emit(makeEvent());

    await new Promise((r) => setTimeout(r, 50));

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(logStore.record).not.toHaveBeenCalled();
  });

  it("logs failure when dispatcher throws", async () => {
    const bus = new InMemoryConversionBus();
    const dispatcher: AdConversionDispatcher = {
      platform: "meta_capi",
      canDispatch: vi.fn().mockReturnValue(true),
      dispatch: vi.fn().mockRejectedValue(new Error("Network error")),
    };
    const logStore = { record: vi.fn().mockResolvedValue({}) };

    wireAdDispatchers(bus, [dispatcher], logStore as never);
    bus.emit(makeEvent());

    await new Promise((r) => setTimeout(r, 50));

    expect(logStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "meta_capi",
        status: "failed",
        errorMessage: "Network error",
      }),
    );
  });
});
