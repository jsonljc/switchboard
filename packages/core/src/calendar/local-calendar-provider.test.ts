import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalCalendarProvider } from "./local-calendar-provider.js";
import type { BusinessHoursConfig, SlotQuery } from "@switchboard/schemas";

const BUSINESS_HOURS: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "18:00" },
    { day: 2, open: "09:00", close: "18:00" },
    { day: 3, open: "09:00", close: "18:00" },
    { day: 4, open: "09:00", close: "18:00" },
    { day: 5, open: "09:00", close: "18:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

function makeBookingStore() {
  return {
    findOverlapping: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };
}

describe("LocalCalendarProvider", () => {
  let store: ReturnType<typeof makeBookingStore>;
  let provider: LocalCalendarProvider;

  beforeEach(() => {
    store = makeBookingStore();
    provider = new LocalCalendarProvider({
      businessHours: BUSINESS_HOURS,
      bookingStore: store,
    });
  });

  describe("listAvailableSlots", () => {
    it("generates slots from business hours for a weekday", async () => {
      const query: SlotQuery = {
        dateFrom: "2026-04-27T00:00:00+08:00",
        dateTo: "2026-04-27T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };
      const slots = await provider.listAvailableSlots(query);
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.every((s) => s.available)).toBe(true);
      expect(slots.every((s) => s.calendarId === "local")).toBe(true);
    });

    it("returns no slots for a weekend (Saturday)", async () => {
      const query: SlotQuery = {
        dateFrom: "2026-04-25T00:00:00+08:00",
        dateTo: "2026-04-25T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };
      const slots = await provider.listAvailableSlots(query);
      expect(slots).toHaveLength(0);
    });

    it("excludes slots that overlap with existing bookings", async () => {
      store.findOverlapping.mockResolvedValue([
        {
          startsAt: new Date("2026-04-27T01:00:00Z"),
          endsAt: new Date("2026-04-27T01:30:00Z"),
        },
      ]);
      const query: SlotQuery = {
        dateFrom: "2026-04-27T09:00:00+08:00",
        dateTo: "2026-04-27T10:00:00+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };
      const slots = await provider.listAvailableSlots(query);
      const hasOverlapping = slots.some((s) => {
        const start = new Date(s.start).getTime();
        const end = new Date(s.end).getTime();
        const busyStart = new Date("2026-04-27T01:00:00Z").getTime();
        const busyEnd = new Date("2026-04-27T01:30:00Z").getTime();
        return start < busyEnd && end > busyStart;
      });
      expect(hasOverlapping).toBe(false);
    });
  });

  describe("createBooking", () => {
    it("mints a local- prefixed calendarEventId and writes no DB row (durable store is the single writer)", async () => {
      const result = await provider.createBooking({
        contactId: "c1",
        organizationId: "org1",
        slot: {
          start: "2026-04-27T09:00:00+08:00",
          end: "2026-04-27T09:30:00+08:00",
          calendarId: "local",
          available: true,
        },
        service: "consultation",
        createdByType: "agent",
      });
      expect(result.calendarEventId).toMatch(/^local-/);
      expect(result.status).toBe("confirmed");
      expect(result.startsAt).toBe("2026-04-27T09:00:00+08:00");
      // No store write: this provider only mints the calendar handle.
      expect(store.findOverlapping).not.toHaveBeenCalled();
      expect(store.findById).not.toHaveBeenCalled();
    });
  });

  describe("healthCheck", () => {
    it("returns connected status", async () => {
      const health = await provider.healthCheck();
      expect(health.status).toBe("connected");
      expect(health.latencyMs).toBe(0);
    });
  });

  describe("getBooking", () => {
    it("delegates to store", async () => {
      store.findById.mockResolvedValue({ id: "b1", status: "confirmed" });
      const result = await provider.getBooking("b1");
      expect(result).toBeTruthy();
      expect(store.findById).toHaveBeenCalledWith("b1");
    });
  });

  describe("reschedule/cancel are no-ops (durable store owns the row)", () => {
    it("rescheduleBooking does not write to the store and echoes the new slot + eventId", async () => {
      const result = await provider.rescheduleBooking("local-evt-123", {
        start: "2026-09-01T02:00:00.000Z",
        end: "2026-09-01T03:00:00.000Z",
        calendarId: "local",
        available: true,
      });
      expect(store.findOverlapping).not.toHaveBeenCalled();
      expect(store.findById).not.toHaveBeenCalled();
      expect(result.calendarEventId).toBe("local-evt-123");
      expect(result.startsAt).toBe("2026-09-01T02:00:00.000Z");
      expect(result.endsAt).toBe("2026-09-01T03:00:00.000Z");
      expect(result.status).toBe("confirmed");
    });

    it("cancelBooking does not write to the store and resolves void", async () => {
      await expect(provider.cancelBooking("local-evt-123")).resolves.toBeUndefined();
      expect(store.findOverlapping).not.toHaveBeenCalled();
      expect(store.findById).not.toHaveBeenCalled();
    });
  });

  describe("notifyBookingConfirmed (post-confirm email)", () => {
    const notification = {
      bookingId: "bk-durable-1",
      attendeeEmail: "sarah@example.com",
      attendeeName: "Sarah",
      service: "consultation",
      startsAt: "2026-04-27T09:00:00+08:00",
      endsAt: "2026-04-27T09:30:00+08:00",
    };

    it("sends the RESEND email keyed on the durable booking id when attendeeEmail is set", async () => {
      const emailSender = vi.fn().mockResolvedValue(undefined);
      const p = new LocalCalendarProvider({
        businessHours: BUSINESS_HOURS,
        bookingStore: makeBookingStore(),
        emailSender,
      });
      await p.notifyBookingConfirmed(notification);
      expect(emailSender).toHaveBeenCalledTimes(1);
      expect(emailSender).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "sarah@example.com",
          attendeeName: "Sarah",
          service: "consultation",
          startsAt: "2026-04-27T09:00:00+08:00",
          endsAt: "2026-04-27T09:30:00+08:00",
          bookingId: "bk-durable-1",
        }),
      );
    });

    it("does not send when attendeeEmail is null", async () => {
      const emailSender = vi.fn();
      const p = new LocalCalendarProvider({
        businessHours: BUSINESS_HOURS,
        bookingStore: makeBookingStore(),
        emailSender,
      });
      await p.notifyBookingConfirmed({ ...notification, attendeeEmail: null });
      expect(emailSender).not.toHaveBeenCalled();
    });

    it("does not throw and calls onSendFailure when the sender fails (best-effort)", async () => {
      const emailSender = vi.fn().mockRejectedValue(new Error("SMTP down"));
      const onSendFailure = vi.fn();
      const p = new LocalCalendarProvider({
        businessHours: BUSINESS_HOURS,
        bookingStore: makeBookingStore(),
        emailSender,
        onSendFailure,
      });
      await expect(p.notifyBookingConfirmed(notification)).resolves.toBeUndefined();
      expect(onSendFailure).toHaveBeenCalledWith({ bookingId: "bk-durable-1", error: "SMTP down" });
    });

    it("no-ops without an emailSender (backwards compatible)", async () => {
      await expect(provider.notifyBookingConfirmed(notification)).resolves.toBeUndefined();
    });
  });

  describe("org-scoped queries", () => {
    it("calls findOverlapping with only date range (no orgId)", async () => {
      const query: SlotQuery = {
        dateFrom: "2026-04-27T00:00:00+08:00",
        dateTo: "2026-04-27T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };
      await provider.listAvailableSlots(query);

      expect(store.findOverlapping).toHaveBeenCalledWith(expect.any(Date), expect.any(Date));
    });
  });
});

import {
  describe as describeOrgScope,
  it as itOrgScope,
  expect as expectOrgScope,
  vi as viOrgScope,
} from "vitest";
import type { LocalBookingStore as LocalBookingStoreOrgScope } from "./local-calendar-provider.js";
import { LocalCalendarProvider as LocalCalendarProviderOrgScope } from "./local-calendar-provider.js";

const __businessHoursForOrgScope = {
  timezone: "Asia/Singapore",
  days: [{ day: 1, open: "09:00", close: "17:00" }],
  defaultDurationMinutes: 30,
  bufferMinutes: 0,
  slotIncrementMinutes: 30,
} as never;

describeOrgScope("LocalCalendarProvider listAvailableSlots org scoping", () => {
  itOrgScope("does not call findOverlapping with an orgId argument", async () => {
    const findOverlapping = viOrgScope.fn().mockResolvedValue([]);
    const store: LocalBookingStoreOrgScope = {
      findOverlapping,
      findById: viOrgScope.fn(),
    };
    const provider = new LocalCalendarProviderOrgScope({
      businessHours: __businessHoursForOrgScope,
      bookingStore: store,
    });

    await provider.listAvailableSlots({
      dateFrom: "2026-05-01T00:00:00Z",
      dateTo: "2026-05-02T00:00:00Z",
      durationMinutes: 30,
      bufferMinutes: 0,
    } as never);

    expectOrgScope(findOverlapping).toHaveBeenCalledTimes(1);
    const args = findOverlapping.mock.calls[0]!;
    expectOrgScope(args).toHaveLength(2);
    expectOrgScope(args[0]).toBeInstanceOf(Date);
    expectOrgScope(args[1]).toBeInstanceOf(Date);
  });
});
