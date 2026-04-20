import type { CalendarProvider, BusinessHoursConfig } from "@switchboard/schemas";
import { GoogleCalendarAdapter } from "@switchboard/core/calendar";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
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

export async function createGoogleCalendarProvider(opts: {
  credentials: string;
  calendarId: string;
  businessHours?: BusinessHoursConfig | null;
}): Promise<CalendarProvider> {
  const { google } = await import("googleapis");

  const key = JSON.parse(opts.credentials) as ServiceAccountKey;
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  const calendar = google.calendar({ version: "v3", auth });

  return new GoogleCalendarAdapter({
    calendarClient: calendar as never,
    calendarId: opts.calendarId,
    businessHours: opts.businessHours ?? DEFAULT_BUSINESS_HOURS,
  });
}
