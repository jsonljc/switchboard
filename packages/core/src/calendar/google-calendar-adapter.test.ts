import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleCalendarAdapter } from "./google-calendar-adapter.js";
import type { BusinessHoursConfig } from "@switchboard/schemas";

const businessHours: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [{ day: 1, open: "09:00", close: "17:00" }],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

function makeGoogleClient() {
  return {
    freebusy: { query: vi.fn() },
    events: { insert: vi.fn(), delete: vi.fn(), patch: vi.fn(), get: vi.fn() },
  };
}

describe("GoogleCalendarAdapter", () => {
  let google: ReturnType<typeof makeGoogleClient>;
  let adapter: GoogleCalendarAdapter;

  beforeEach(() => {
    google = makeGoogleClient();
    adapter = new GoogleCalendarAdapter({
      calendarClient: google as never,
      calendarId: "primary",
      businessHours,
    });
  });

  it("listAvailableSlots queries freebusy and generates slots", async () => {
    google.freebusy.query.mockResolvedValue({
      data: { calendars: { primary: { busy: [] } } },
    });

    const slots = await adapter.listAvailableSlots({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      service: "consultation",
      timezone: "Asia/Singapore",
      bufferMinutes: 15,
    });

    expect(google.freebusy.query).toHaveBeenCalled();
    expect(slots.length).toBeGreaterThan(0);
  });

  it("createBooking inserts a Google Calendar event", async () => {
    google.events.insert.mockResolvedValue({
      data: { id: "gcal_123", htmlLink: "https://calendar.google.com/event/gcal_123" },
    });

    const result = await adapter.createBooking({
      contactId: "ct_1",
      organizationId: "org_1",
      slot: {
        start: "2026-04-20T10:00:00+08:00",
        end: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
        available: true,
      },
      service: "consultation",
      attendeeName: "Alice",
      attendeeEmail: "alice@example.com",
      createdByType: "agent",
    });

    expect(result.calendarEventId).toBe("gcal_123");
    expect(result.status).toBe("confirmed");
    expect(google.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        requestBody: expect.objectContaining({
          summary: expect.stringContaining("consultation"),
        }),
      }),
    );
  });

  it("healthCheck returns connected when API responds", async () => {
    google.events.get.mockResolvedValue({ data: {} });
    const health = await adapter.healthCheck();
    expect(health.status).toBe("connected");
  });

  it("healthCheck returns connected even on 404 (expected for non-existent event)", async () => {
    google.events.get.mockRejectedValue(new Error("Not Found"));
    const health = await adapter.healthCheck();
    expect(health.status).toBe("connected");
  });
});
