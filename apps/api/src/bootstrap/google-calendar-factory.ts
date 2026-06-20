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

/**
 * Build a Google Calendar provider from a clinic's OWN per-deployment OAuth credentials (the
 * refresh token the google-calendar-oauth callback stores on its DeploymentConnection). Unlike
 * createGoogleCalendarProvider (a shared service-account JWT), this authenticates as the connected
 * Google user, so bookings land on that clinic's own calendar. clientId/clientSecret are the
 * platform's OAuth app creds (GOOGLE_CALENDAR_CLIENT_ID/SECRET) used to refresh the access token.
 */
export async function createGoogleCalendarProviderFromOAuth(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  businessHours?: BusinessHoursConfig | null;
}): Promise<CalendarProvider> {
  const { google } = await import("googleapis");

  const oauth2Client = new google.auth.OAuth2(opts.clientId, opts.clientSecret);
  oauth2Client.setCredentials({ refresh_token: opts.refreshToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  return new GoogleCalendarAdapter({
    calendarClient: calendar as never,
    calendarId: opts.calendarId,
    businessHours: opts.businessHours ?? DEFAULT_BUSINESS_HOURS,
  });
}
