import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutcomeDispatcher, synthesizeOutcomeEventId } from "./outcome-dispatcher.js";

const makeContact = (sourceType: string, attribution: Record<string, unknown>) => ({
  id: "c1",
  organizationId: "o1",
  sourceType,
  attribution,
});

const FIXED_TIME = new Date("2026-04-30T12:00:00Z");

describe("OutcomeDispatcher", () => {
  let capi: { dispatch: ReturnType<typeof vi.fn> };
  let store: { getContact: ReturnType<typeof vi.fn> };
  let dispatcher: OutcomeDispatcher;

  beforeEach(() => {
    capi = { dispatch: vi.fn().mockResolvedValue({ ok: true }) };
    store = { getContact: vi.fn() };
    dispatcher = new OutcomeDispatcher({ capi, store });
  });

  it("CTWA booked → Schedule with action_source=business_messaging + ctwa_clid", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({ contactId: "c1", kind: "booked", occurredAt: FIXED_TIME });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Schedule",
        actionSource: "business_messaging",
        attribution: expect.objectContaining({ ctwa_clid: "abc" }),
        eventId: expect.any(String),
      }),
    );
  });

  it("Instant Form qualified → Lead with action_source=system_generated", async () => {
    store.getContact.mockResolvedValue(makeContact("instant_form", { leadgen_id: "9" }));
    await dispatcher.handle({ contactId: "c1", kind: "qualified", occurredAt: FIXED_TIME });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Lead",
        actionSource: "system_generated",
      }),
    );
  });

  it("paid event includes value", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({
      contactId: "c1",
      kind: "paid",
      occurredAt: FIXED_TIME,
      value: 250.5,
      currency: "SGD",
    });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "Purchase", value: 250.5, currency: "SGD" }),
    );
  });

  it("organic source → no dispatch, warns", async () => {
    store.getContact.mockResolvedValue(makeContact("organic", {}));
    await dispatcher.handle({ contactId: "c1", kind: "booked", occurredAt: FIXED_TIME });
    expect(capi.dispatch).not.toHaveBeenCalled();
  });

  it("missing contact → no dispatch, warns", async () => {
    store.getContact.mockResolvedValue(null);
    await dispatcher.handle({ contactId: "missing", kind: "qualified", occurredAt: FIXED_TIME });
    expect(capi.dispatch).not.toHaveBeenCalled();
  });

  it("contact with null sourceType → no dispatch, warns", async () => {
    store.getContact.mockResolvedValue({
      id: "c1",
      organizationId: "o1",
      sourceType: null,
      attribution: {},
    });
    await dispatcher.handle({ contactId: "c1", kind: "qualified", occurredAt: FIXED_TIME });
    expect(capi.dispatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Idempotency (Risk #3): event_id must be stable across Inngest retries so
  // duplicate deliveries deduplicate at Meta's CAPI.
  // -------------------------------------------------------------------------

  it("synthesizes deterministic event_id from (contactId, kind, occurredAt) when no eventId given", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({ contactId: "c1", kind: "booked", occurredAt: FIXED_TIME });
    await dispatcher.handle({ contactId: "c1", kind: "booked", occurredAt: FIXED_TIME });

    const id1 = capi.dispatch.mock.calls[0]![0].eventId;
    const id2 = capi.dispatch.mock.calls[1]![0].eventId;
    expect(id1).toBeTruthy();
    expect(id1).toBe(id2);
  });

  it("synthesized event_id differs when bookingId differs (re-booking disambiguation)", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({
      contactId: "c1",
      kind: "booked",
      occurredAt: FIXED_TIME,
      bookingId: "b1",
    });
    await dispatcher.handle({
      contactId: "c1",
      kind: "booked",
      occurredAt: FIXED_TIME,
      bookingId: "b2",
    });

    const id1 = capi.dispatch.mock.calls[0]![0].eventId;
    const id2 = capi.dispatch.mock.calls[1]![0].eventId;
    expect(id1).not.toBe(id2);
  });

  it("caller-supplied event_id passes through verbatim, overriding synthesis", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({
      contactId: "c1",
      kind: "booked",
      occurredAt: FIXED_TIME,
      eventId: "upstream-stable-id-xyz",
    });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "upstream-stable-id-xyz" }),
    );
  });

  it("synthesizeOutcomeEventId is pure: same inputs => same hash, different inputs => different hashes", () => {
    const a = synthesizeOutcomeEventId({
      contactId: "c1",
      kind: "booked",
      occurredAt: FIXED_TIME,
    });
    const b = synthesizeOutcomeEventId({
      contactId: "c1",
      kind: "booked",
      occurredAt: FIXED_TIME,
    });
    const c = synthesizeOutcomeEventId({
      contactId: "c1",
      kind: "booked",
      occurredAt: new Date("2026-04-30T12:00:01Z"),
    });
    const d = synthesizeOutcomeEventId({
      contactId: "c2",
      kind: "booked",
      occurredAt: FIXED_TIME,
    });
    const e = synthesizeOutcomeEventId({
      contactId: "c1",
      kind: "qualified",
      occurredAt: FIXED_TIME,
    });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).not.toBe(e);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
