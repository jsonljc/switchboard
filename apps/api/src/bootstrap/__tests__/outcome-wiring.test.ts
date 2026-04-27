import { describe, it, expect, vi } from "vitest";
import { subscribeOutcomeDispatcher } from "../outcome-wiring.js";

describe("subscribeOutcomeDispatcher", () => {
  it("forwards lifecycle.booked events to OutcomeDispatcher", async () => {
    const handle = vi.fn();
    const bus = { subscribe: vi.fn() };
    subscribeOutcomeDispatcher({ bus, dispatcher: { handle } });
    expect(bus.subscribe).toHaveBeenCalledWith("lifecycle.booked", expect.any(Function));
    const callback = bus.subscribe.mock.calls.find(
      (c: unknown[]) => c[0] === "lifecycle.booked",
    )?.[1] as (payload: { contactId: string }) => Promise<void>;
    expect(callback).toBeDefined();
    await callback({ contactId: "c1" });
    expect(handle).toHaveBeenCalledWith({
      contactId: "c1",
      kind: "booked",
      value: undefined,
      currency: undefined,
    });
  });

  it("subscribes to all four lifecycle outcome events", () => {
    const bus = { subscribe: vi.fn() };
    subscribeOutcomeDispatcher({ bus, dispatcher: { handle: vi.fn() } });
    const events = bus.subscribe.mock.calls.map((c: unknown[]) => c[0]);
    expect(events).toEqual(
      expect.arrayContaining([
        "lifecycle.qualified",
        "lifecycle.booked",
        "lifecycle.showed",
        "lifecycle.paid",
      ]),
    );
  });

  it("forwards value and currency on paid events", async () => {
    const handle = vi.fn();
    const bus = { subscribe: vi.fn() };
    subscribeOutcomeDispatcher({ bus, dispatcher: { handle } });
    const paidCb = bus.subscribe.mock.calls.find(
      (c: unknown[]) => c[0] === "lifecycle.paid",
    )?.[1] as (p: { contactId: string; value?: number; currency?: string }) => Promise<void>;
    await paidCb({ contactId: "c1", value: 250.5, currency: "SGD" });
    expect(handle).toHaveBeenCalledWith({
      contactId: "c1",
      kind: "paid",
      value: 250.5,
      currency: "SGD",
    });
  });
});
