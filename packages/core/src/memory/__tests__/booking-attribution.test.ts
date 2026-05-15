import { describe, it, expect, vi } from "vitest";
import {
  resolveBookingAttribution,
  type BookingAttributionStore,
  ATTRIBUTION_WINDOW_MS,
} from "../booking-attribution.js";
import type { ConversationEndEvent } from "../../channel-gateway/conversation-lifecycle.js";

function event(overrides: Partial<ConversationEndEvent> = {}): ConversationEndEvent {
  return {
    deploymentId: "dep-1",
    organizationId: "org-1",
    contactId: "ct-1",
    channelType: "whatsapp",
    sessionId: "ses-1",
    messages: [],
    duration: 60_000,
    messageCount: 4,
    endReason: "explicit_close",
    endedAt: new Date("2026-05-14T10:00:00Z"),
    workTraceIds: ["wt-A", "wt-B"],
    ...overrides,
  };
}

describe("resolveBookingAttribution", () => {
  it("returns strong attribution when a Booking shares a workTraceId with the conversation", async () => {
    const store: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-B" }]),
      findInWindow: vi.fn(),
    };

    const result = await resolveBookingAttribution(store, event());

    expect(result.tier).toBe("strong");
    expect(result.bookingId).toBe("bk-1");
    expect(result.workTraceId).toBe("wt-B");
    expect(store.findInWindow).not.toHaveBeenCalled();
  });

  it("falls back to contact+window when no workTraceId matches", async () => {
    const store: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([{ id: "bk-2" }]),
    };

    const result = await resolveBookingAttribution(store, event());

    expect(result.tier).toBe("fallback");
    expect(result.bookingId).toBe("bk-2");
    expect(store.findInWindow).toHaveBeenCalledWith(
      "org-1",
      "ct-1",
      new Date("2026-05-14T10:00:00Z"),
      new Date("2026-05-15T10:00:00Z"),
    );
  });

  it("returns none when neither tier produces a booking", async () => {
    const store: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([]),
    };

    const result = await resolveBookingAttribution(store, event());
    expect(result.tier).toBe("none");
    expect(result.bookingId).toBeUndefined();
  });

  it("skips the strong path entirely when workTraceIds is empty/undefined", async () => {
    const store: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-x", workTraceId: "wt-Z" }]),
      findInWindow: vi.fn().mockResolvedValue([]),
    };

    await resolveBookingAttribution(store, event({ workTraceIds: undefined }));
    expect(store.findByWorkTraceIds).not.toHaveBeenCalled();

    await resolveBookingAttribution(store, event({ workTraceIds: [] }));
    expect(store.findByWorkTraceIds).not.toHaveBeenCalled();
  });

  it("returns none when contactId is null and strong tier missed", async () => {
    const store: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn(),
    };

    const result = await resolveBookingAttribution(store, event({ contactId: null }));
    expect(result.tier).toBe("none");
    expect(store.findInWindow).not.toHaveBeenCalled();
  });

  it("uses a strict post-conversation window — pre-conversation bookings do not attribute", async () => {
    // This is enforced by the store contract: findInWindow takes (start, end).
    // The resolver passes endedAt as start, so the store must filter strictly
    // by createdAt > endedAt. We assert the resolver passes the right bounds —
    // the store-implementation test (Task 20) pins the SQL.
    const store: BookingAttributionStore = {
      findByWorkTraceIds: vi.fn().mockResolvedValue([]),
      findInWindow: vi.fn().mockResolvedValue([]),
    };
    await resolveBookingAttribution(store, event());
    const args = (store.findInWindow as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const [, , start, end] = args;
    expect(start).toEqual(new Date("2026-05-14T10:00:00Z"));
    expect(end).toEqual(new Date("2026-05-15T10:00:00Z"));
    expect(end.getTime() - start.getTime()).toBe(ATTRIBUTION_WINDOW_MS);
  });
});
