import { describe, it, expect, vi } from "vitest";
import { subscribeOutcomeDispatcher } from "../outcome-wiring.js";

const FIXED_TIME = new Date("2026-04-30T12:00:00Z");

describe("subscribeOutcomeDispatcher", () => {
  it("forwards lifecycle.booked events to OutcomeDispatcher with occurredAt + bookingId", async () => {
    const handle = vi.fn();
    const bus = { subscribe: vi.fn() };
    subscribeOutcomeDispatcher({ bus, dispatcher: { handle } });
    expect(bus.subscribe).toHaveBeenCalledWith("lifecycle.booked", expect.any(Function));
    const callback = bus.subscribe.mock.calls.find(
      (c: unknown[]) => c[0] === "lifecycle.booked",
    )?.[1] as (payload: {
      contactId: string;
      occurredAt: Date;
      bookingId?: string;
    }) => Promise<void>;
    expect(callback).toBeDefined();
    await callback({ contactId: "c1", occurredAt: FIXED_TIME, bookingId: "b1" });
    expect(handle).toHaveBeenCalledWith({
      contactId: "c1",
      kind: "booked",
      occurredAt: FIXED_TIME,
      eventId: undefined,
      bookingId: "b1",
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
    )?.[1] as (p: {
      contactId: string;
      occurredAt: Date;
      value?: number;
      currency?: string;
    }) => Promise<void>;
    await paidCb({ contactId: "c1", occurredAt: FIXED_TIME, value: 250.5, currency: "SGD" });
    expect(handle).toHaveBeenCalledWith({
      contactId: "c1",
      kind: "paid",
      occurredAt: FIXED_TIME,
      eventId: undefined,
      bookingId: undefined,
      value: 250.5,
      currency: "SGD",
    });
  });

  it("forwards caller-supplied eventId verbatim (skips synthesis when upstream has stable id)", async () => {
    const handle = vi.fn();
    const bus = { subscribe: vi.fn() };
    subscribeOutcomeDispatcher({ bus, dispatcher: { handle } });
    const qualifiedCb = bus.subscribe.mock.calls.find(
      (c: unknown[]) => c[0] === "lifecycle.qualified",
    )?.[1] as (p: { contactId: string; occurredAt: Date; eventId?: string }) => Promise<void>;
    await qualifiedCb({
      contactId: "c1",
      occurredAt: FIXED_TIME,
      eventId: "inngest-evt-abc",
    });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ eventId: "inngest-evt-abc" }));
  });
});
