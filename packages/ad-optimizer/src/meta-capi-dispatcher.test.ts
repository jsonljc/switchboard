import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaCAPIDispatcher } from "./meta-capi-dispatcher.js";
import type { ConversionEvent, ConversionStage } from "@switchboard/schemas";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "org_1:act_1:Booking:bk_1:booked:status_confirmed",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    // Relative date — the dispatcher rejects events older than 7 days as
    // event_time_too_old, so a hardcoded past date silently breaks fixtures
    // once the calendar passes. Use "1 minute ago" to stay within the window.
    occurredAt: new Date(Date.now() - 60_000),
    source: "Booking",
    metadata: {},
    customer: { email: "test@example.com", phone: "+6591234567" },
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

  // ── canDispatch ──

  it("canDispatch returns true with lead_id in attribution", () => {
    expect(dispatcher.canDispatch(makeEvent({ attribution: { lead_id: "lead_123" } }))).toBe(true);
  });

  it("canDispatch returns true with fbclid in attribution", () => {
    expect(dispatcher.canDispatch(makeEvent({ attribution: { fbclid: "fb_abc" } }))).toBe(true);
  });

  it("canDispatch returns true with customer email only", () => {
    expect(dispatcher.canDispatch(makeEvent({ customer: { email: "a@b.com" } }))).toBe(true);
  });

  it("canDispatch returns true with customer phone only", () => {
    expect(dispatcher.canDispatch(makeEvent({ customer: { phone: "+1234" } }))).toBe(true);
  });

  it("canDispatch returns true with legacy metadata email", () => {
    expect(
      dispatcher.canDispatch(makeEvent({ customer: undefined, metadata: { email: "a@b.com" } })),
    ).toBe(true);
  });

  it("canDispatch returns false when no match keys", () => {
    expect(dispatcher.canDispatch(makeEvent({ customer: undefined, metadata: {} }))).toBe(false);
  });

  it("canDispatch returns false even with sourceAdId but no PII/attribution", () => {
    expect(
      dispatcher.canDispatch(
        makeEvent({ sourceAdId: "ad_123", customer: undefined, metadata: {} }),
      ),
    ).toBe(false);
  });

  // ── Attribution path: Lead Ads CRM ──

  it("uses action_source crm when lead_id is present", async () => {
    const event = makeEvent({ attribution: { lead_id: "lead_123" } });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].action_source).toBe("crm");
    expect(body.data[0].user_data.lead_id).toBe("lead_123");
  });

  // ── Attribution path: Website ──

  it("uses action_source website when full web context exists", async () => {
    const event = makeEvent({
      attribution: {
        fbclid: "fb_abc",
        eventSourceUrl: "https://example.com/landing",
        clientUserAgent: "Mozilla/5.0",
      },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].action_source).toBe("website");
    expect(body.data[0].event_source_url).toBe("https://example.com/landing");
    expect(body.data[0].user_data.client_user_agent).toBe("Mozilla/5.0");
    expect(body.data[0].user_data.fbc).toMatch(/^fb\.1\.\d+\.fb_abc$/);
  });

  // ── Attribution path: Fallback ──

  it("uses action_source system_generated for PII-only events", async () => {
    const event = makeEvent({ customer: { email: "a@b.com" } });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].action_source).toBe("system_generated");
  });

  it("includes fbc in fallback when fbclid exists without full web context", async () => {
    const event = makeEvent({
      attribution: { fbclid: "fb_partial" },
      customer: { email: "a@b.com" },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].action_source).toBe("system_generated");
    expect(body.data[0].user_data.fbc).toMatch(/^fb\.1\.\d+\.fb_partial$/);
  });

  // ── Explicit actionSource override ──

  it("uses explicit actionSource override when provided", async () => {
    const event = makeEvent({
      actionSource: "business_messaging",
      attribution: { fbclid: "fb_ctwa" },
      customer: { phone: "+6591234567" },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].action_source).toBe("business_messaging");
  });

  it("falls back to inferred action_source when override absent", async () => {
    const event = makeEvent({ attribution: { lead_id: "lead_123" } });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].action_source).toBe("crm");
  });

  // ── Stage-to-event-name mapping ──

  it.each([
    ["inquiry", "Contact"],
    ["qualified", "QualifiedLead"],
    ["booked", "ConvertedLead"],
    ["purchased", "Purchase"],
    ["completed", "Purchase"],
  ] as [ConversionStage, string][])("maps stage %s to Meta event %s", async (stage, metaName) => {
    const event = makeEvent({ type: stage });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].event_name).toBe(metaName);
  });

  // ── eventId pass-through ──

  it("passes eventId as event_id in payload", async () => {
    const event = makeEvent({ eventId: "org_1:act_1:Booking:bk_1:booked:confirmed" });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].event_id).toBe("org_1:act_1:Booking:bk_1:booked:confirmed");
  });

  // ── Currency ──

  it("includes custom_data when value and currency are present", async () => {
    const event = makeEvent({ value: 500, currency: "SGD" });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].custom_data).toEqual({ value: 500, currency: "SGD" });
  });

  it("omits custom_data when value exists but currency is missing", async () => {
    const event = makeEvent({ value: 500 });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].custom_data).toBeUndefined();
  });

  it("omits custom_data when no value", async () => {
    const event = makeEvent();
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].custom_data).toBeUndefined();
  });

  // ── 7-day timing guardrail ──

  it("rejects events older than 7 days", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    const event = makeEvent({ occurredAt: eightDaysAgo });
    const result = await dispatcher.dispatch(event);

    expect(result.accepted).toBe(false);
    expect(result.errorMessage).toBe("event_time_too_old");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts events within 7 days", async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const event = makeEvent({ occurredAt: twoDaysAgo });
    const result = await dispatcher.dispatch(event);

    expect(result.accepted).toBe(true);
  });

  // ── PII hashing ──

  it("hashes email and phone in user_data", async () => {
    const event = makeEvent({
      customer: { email: "Test@Example.COM", phone: "+65 9123 4567" },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    const ud = body.data[0].user_data;
    expect(ud.em).toMatch(/^[a-f0-9]{64}$/);
    expect(ud.ph).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads PII from metadata as fallback", async () => {
    const event = makeEvent({
      customer: undefined,
      metadata: { email: "legacy@test.com", phone: "+1234" },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.data[0].user_data.em).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data[0].user_data.ph).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── Error handling ──

  it("returns rejected on HTTP error", async () => {
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
