import {
  type CalendarProvider,
  type BusinessHoursConfig,
  DEFAULT_BUSINESS_HOURS,
} from "@switchboard/schemas";
import { GoogleCalendarAdapter } from "@switchboard/core/calendar";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

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
