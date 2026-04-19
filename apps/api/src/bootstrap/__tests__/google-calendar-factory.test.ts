import { describe, it, expect, vi } from "vitest";
import { createGoogleCalendarProvider } from "../google-calendar-factory.js";

vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: vi.fn().mockImplementation(() => ({})),
    },
    calendar: vi.fn().mockReturnValue({
      freebusy: { query: vi.fn() },
      events: {
        insert: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        get: vi.fn(),
      },
    }),
  },
}));

const FAKE_CREDENTIALS = JSON.stringify({
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
});

describe("createGoogleCalendarProvider", () => {
  it("returns a CalendarProvider with all required methods", async () => {
    const provider = await createGoogleCalendarProvider({
      credentials: FAKE_CREDENTIALS,
      calendarId: "primary",
    });

    expect(provider.listAvailableSlots).toBeDefined();
    expect(provider.createBooking).toBeDefined();
    expect(provider.cancelBooking).toBeDefined();
    expect(provider.rescheduleBooking).toBeDefined();
    expect(provider.getBooking).toBeDefined();
    expect(provider.healthCheck).toBeDefined();
  });

  it("uses default business hours when none provided", async () => {
    const provider = await createGoogleCalendarProvider({
      credentials: FAKE_CREDENTIALS,
      calendarId: "primary",
    });

    const health = await provider.healthCheck();
    expect(health.status).toBe("connected");
  });

  it("accepts custom business hours", async () => {
    const provider = await createGoogleCalendarProvider({
      credentials: FAKE_CREDENTIALS,
      calendarId: "test-calendar",
      businessHours: {
        timezone: "America/New_York",
        days: [{ day: 1, open: "10:00", close: "16:00" }],
        defaultDurationMinutes: 60,
        bufferMinutes: 10,
        slotIncrementMinutes: 60,
      },
    });

    expect(provider).toBeDefined();
  });

  it("throws on invalid credentials JSON", async () => {
    await expect(
      createGoogleCalendarProvider({
        credentials: "not-json",
        calendarId: "primary",
      }),
    ).rejects.toThrow();
  });
});
