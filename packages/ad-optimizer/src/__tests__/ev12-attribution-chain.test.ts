import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaCAPIDispatcher } from "../meta-capi-dispatcher.js";
import { MetaCAPIClient } from "../meta-capi-client.js";
import { buildCtwaIntake } from "../lead-intake/ctwa-adapter.js";
import type { ConversionEvent } from "@switchboard/schemas";

/**
 * EV-12 — Attribution chain (Layer-2 / ad-optimizer half). DETERMINISTIC: no
 * live Meta call, no access token, no DB. Pins the `clid -> booked ->
 * ConversionEvent -> dispatched Meta event` chain at the dispatch boundary.
 *
 * This file covers the ad-optimizer end of the chain (the dispatcher + legacy
 * client + the CTWA intake builder) — i.e. chain ENTRY plus the dispatch
 * boundary. The Layer-3 fold half — where a folded Contact's `ctwa_clid` would
 * fold into the booked conversion payload, and where that fold is found to DROP
 * `ctwa_clid` (a SURFACED MONEY-5 attribution-loss finding) — is pinned in
 * `packages/core/src/skill-runtime/__tests__/ev12-attribution-fold.test.ts`,
 * because ad-optimizer (Layer 2) cannot import `@switchboard/core` (Layer 3).
 *
 * Groups:
 *  - MONEY-4: event_time == the CONVERSION time (Booking commit time, mapped via
 *    `occurredAt`) end-to-end, never a future appointment slot and never the
 *    dispatch wall-clock. Also resolves BUG-10 — the `meta-capi-client.ts:36`
 *    `fbc` path stamps a wall-clock `Date.now()` where `MetaCAPIDispatcher` uses
 *    the conversion's `occurredAt`. See the PR body for the SURFACE finding.
 *  - MONEY-5 (chain ENTRY only): the CTWA `ctwa_clid` is captured into the
 *    LeadIntake by `buildCtwaIntake`. This is the ENTRY of the chain, not the
 *    fold: the fold-into-booked-payload half (and the ctwa_clid-DROP finding) is
 *    pinned in the core sibling file referenced above.
 *  - MONEY-6: `event_id` is DETERMINISTIC on retry (same conversion re-dispatched
 *    -> same `event_id` -> Meta dedups on `event_id`, not `event_time`).
 */

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "org_1:act_1:Booking:bk_1:booked:status_confirmed",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    occurredAt: new Date(Date.now() - 60_000),
    source: "Booking",
    metadata: {},
    customer: { email: "test@example.com", phone: "+6591234567" },
    ...overrides,
  };
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const event = JSON.parse(fetchMock.mock.calls[call]?.[1]?.body ?? "{}");
  return event.data[0] as Record<string, unknown>;
}

describe("EV-12 attribution chain — ad-optimizer dispatch boundary", () => {
  // A fixed conversion (commit) time and a LATER, distinct dispatch wall-clock so
  // any leak of `Date.now()` into event_time / fbc / event_id is machine-visible.
  const COMMIT_TIME = new Date("2026-06-20T10:00:00.000Z");
  const DISPATCH_WALL = new Date("2026-06-23T15:30:00.000Z"); // 3 days later, inside the 7d window

  // ── MONEY-4: event_time = conversion (commit) time, end-to-end ──

  describe("MONEY-4: event_time equals the conversion time", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let dispatcher: MetaCAPIDispatcher;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(DISPATCH_WALL);
      fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events_received: 1 }),
      });
      dispatcher = new MetaCAPIDispatcher({ pixelId: "px_1", accessToken: "tok_1" }, fetchMock);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("dispatcher maps occurredAt -> event_time (seconds), not the dispatch wall-clock", async () => {
      await dispatcher.dispatch(makeEvent({ occurredAt: COMMIT_TIME }));

      expect(bodyOf(fetchMock).event_time).toBe(Math.floor(COMMIT_TIME.getTime() / 1000));
      // Date.now() (fake) is DISPATCH_WALL; a Date.now()-derived event_time would
      // differ. This is the guard against a wall-clock event_time regression.
      expect(bodyOf(fetchMock).event_time).not.toBe(Math.floor(DISPATCH_WALL.getTime() / 1000));
    });

    it("booked event_time is the commit time, NOT the future appointment slot (#1317)", async () => {
      // A booked conversion happens at commit time; the appointment is 30 days out.
      // Meta rejects a future event_time and silently drops the booked conversion,
      // so the slot must never become the event_time. The dispatcher reads only
      // `occurredAt`; `slotStart` rides along in metadata for other consumers.
      const futureSlot = new Date(COMMIT_TIME.getTime() + 30 * 24 * 60 * 60 * 1000);
      await dispatcher.dispatch(
        makeEvent({
          occurredAt: COMMIT_TIME,
          metadata: { slotStart: futureSlot.toISOString() },
        }),
      );

      const eventTime = bodyOf(fetchMock).event_time as number;
      expect(eventTime).toBe(Math.floor(COMMIT_TIME.getTime() / 1000));
      expect(eventTime).toBeLessThan(Math.floor(futureSlot.getTime() / 1000));
      // Not in the future relative to the dispatch wall-clock either.
      expect(eventTime).toBeLessThanOrEqual(Math.floor(DISPATCH_WALL.getTime() / 1000));
    });

    it("legacy MetaCAPIClient passes the supplied eventTime straight through", async () => {
      // The conversion-bus wiring sets eventTime = Math.floor(occurredAt/1000), so
      // the client's event_time is also the conversion time (a pure pass-through).
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events_received: 1 }),
      });
      global.fetch = mockFetch as never;
      const client = new MetaCAPIClient({ pixelId: "px_1", accessToken: "tok_1" });

      const eventTime = Math.floor(COMMIT_TIME.getTime() / 1000);
      await client.dispatchEvent({ eventName: "Lead", eventTime, userData: { fbclid: "fb_x" } });

      expect(bodyOf(mockFetch).event_time).toBe(eventTime);
    });

    // ── BUG-10 (SURFACE): the fbc creation-time path ──
    // The Meta `fbc` cookie is `fb.<idx>.<creationTime>.<fbclid>`. `creationTime`
    // should be when the click was observed — the dispatcher uses the conversion's
    // `occurredAt` (deterministic, tied to the event). The legacy client stamps it
    // with the dispatch wall-clock `Date.now()` (meta-capi-client.ts:36), which is
    // a real defect: non-deterministic and not the click/conversion time. NOTE:
    // this affects ONLY the fbc creation-time, never `event_time` (correct above).
    // Both assertions below pin CURRENT behavior (green); the fix belongs in a
    // separate core-change PR (see PR body).

    it("dispatcher fbc creation-time uses occurredAt, independent of the wall-clock", async () => {
      await dispatcher.dispatch(
        makeEvent({
          occurredAt: COMMIT_TIME,
          attribution: {
            fbclid: "fb_x",
            eventSourceUrl: "https://example.com/landing",
            clientUserAgent: "Mozilla/5.0",
          },
        }),
      );

      const userData = bodyOf(fetchMock).user_data as Record<string, string>;
      // Deterministic: derived from occurredAt, NOT Date.now() (= DISPATCH_WALL).
      expect(userData.fbc).toBe(`fb.1.${COMMIT_TIME.getTime()}.fb_x`);
      expect(userData.fbc).not.toContain(`${DISPATCH_WALL.getTime()}`);
    });

    it("BUG-10: legacy client fbc creation-time uses wall-clock Date.now(), not occurredAt", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events_received: 1 }),
      });
      global.fetch = mockFetch as never;
      const client = new MetaCAPIClient({ pixelId: "px_1", accessToken: "tok_1" });

      await client.dispatchEvent({
        eventName: "Lead",
        eventTime: Math.floor(COMMIT_TIME.getTime() / 1000),
        userData: { fbclid: "fb_x" },
      });

      const userData = bodyOf(mockFetch).user_data as Record<string, string>;
      // Pins the defect: the creation-time is the dispatch wall-clock, NOT the
      // conversion time. Contrast the dispatcher test directly above.
      expect(userData.fbc).toBe(`fb.1.${DISPATCH_WALL.getTime()}.fb_x`);
      expect(userData.fbc).not.toBe(`fb.1.${COMMIT_TIME.getTime()}.fb_x`);
    });
  });

  // ── MONEY-5 (entry point): the CTWA clid is captured into the LeadIntake ──

  describe("MONEY-5: CTWA ctwa_clid is captured at intake (chain entry)", () => {
    const now = () => new Date("2026-06-20T10:00:00.000Z");

    it("preserves ctwa_clid and keys idempotency on phone+clid", () => {
      const intake = buildCtwaIntake(
        {
          from: "+6591234567",
          organizationId: "org_1",
          deploymentId: "dep_1",
          metadata: {
            ctwaClid: "clid_A",
            sourceAdId: "ad_1",
            ctwaSourceUrl: "https://fb.me/landing",
          },
        },
        { now },
      );

      expect(intake?.attribution.ctwa_clid).toBe("clid_A");
      expect(intake?.attribution.sourceAdId).toBe("ad_1");
      expect(intake?.source).toBe("ctwa");
      // Same person, two ad clicks -> two distinct clids -> distinct intake keys, so
      // the A4 contact fold (not idempotency) is what collapses them downstream.
      expect(intake?.idempotencyKey).toBe("+6591234567:clid_A");
    });

    it("returns null for a non-CTWA message (no ctwa_clid)", () => {
      const intake = buildCtwaIntake(
        {
          from: "+6591234567",
          organizationId: "org_1",
          deploymentId: "dep_1",
          metadata: { sourceAdId: "ad_1" },
        },
        { now },
      );
      expect(intake).toBeNull();
    });
  });

  // ── MONEY-6: event_id is deterministic on retry (Meta dedups on event_id) ──

  describe("MONEY-6: event_id determinism on retry", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("passes ConversionEvent.eventId straight through to the Meta event_id", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events_received: 1 }),
      });
      const dispatcher = new MetaCAPIDispatcher(
        { pixelId: "px_1", accessToken: "tok_1" },
        fetchMock,
      );
      await dispatcher.dispatch(makeEvent({ eventId: "evt_booked_bk_123" }));
      expect(bodyOf(fetchMock).event_id).toBe("evt_booked_bk_123");
    });

    it("re-dispatching the SAME conversion yields an identical event_id (delayed retry)", async () => {
      // FRESH-client-per-call: each retry constructs a NEW dispatcher, so the
      // determinism comes from the event id itself, not shared instance state.
      vi.useFakeTimers();
      vi.setSystemTime(COMMIT_TIME);

      const event = makeEvent({ eventId: "evt_booked_bk_123", occurredAt: COMMIT_TIME });

      const fetch1 = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events_received: 1 }),
      });
      await new MetaCAPIDispatcher({ pixelId: "px_1", accessToken: "tok_1" }, fetch1).dispatch(
        event,
      );

      // The retry happens later in wall-clock time...
      vi.setSystemTime(new Date(COMMIT_TIME.getTime() + 36 * 60 * 60 * 1000)); // +36h
      const fetch2 = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events_received: 1 }),
      });
      await new MetaCAPIDispatcher({ pixelId: "px_1", accessToken: "tok_1" }, fetch2).dispatch(
        event,
      );

      // ...yet the dedup key (event_id) is identical -> Meta collapses the duplicate.
      expect(bodyOf(fetch1).event_id).toBe("evt_booked_bk_123");
      expect(bodyOf(fetch2).event_id).toBe(bodyOf(fetch1).event_id);
    });
  });
});
