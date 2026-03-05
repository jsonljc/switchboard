// ---------------------------------------------------------------------------
// Google Calendar Provider — Real Google Calendar API v3 integration
// ---------------------------------------------------------------------------

import type { CalendarProvider } from "../provider.js";
import type { AppointmentDetails, AppointmentSlot } from "../../../core/types.js";
import type { PlatformHealth } from "../../types.js";
import { withRetry, CircuitBreaker } from "@switchboard/core";

export interface GoogleCalendarConfig {
  /** OAuth2 access token or API key */
  accessToken: string;
  /** Default calendar ID (e.g. "primary" or a specific calendar email) */
  calendarId: string;
  /** Service account credentials JSON (optional, for server-to-server) */
  serviceAccountKey?: string;
}

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Real Google Calendar provider using the Calendar API v3.
 * All calls wrapped with retry + circuit breaker.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly platform = "google" as const;
  private readonly config: GoogleCalendarConfig;
  private readonly breaker: CircuitBreaker;

  constructor(config: GoogleCalendarConfig) {
    this.config = config;
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 3,
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    return this.breaker.execute(() =>
      withRetry(fn, {
        maxAttempts: 3,
        shouldRetry: (err: unknown) => {
          if (err instanceof Error) {
            const msg = err.message;
            return (
              msg.includes("429") ||
              msg.includes("503") ||
              msg.includes("ETIMEDOUT") ||
              msg.includes("ECONNRESET")
            );
          }
          return false;
        },
      }),
    );
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  async bookAppointment(
    calendarId: string,
    contactId: string,
    startTime: Date,
    endTime: Date,
    title: string,
    notes?: string,
  ): Promise<AppointmentDetails> {
    return this.call(async () => {
      const calId = calendarId || this.config.calendarId;
      const event = {
        summary: title,
        description: notes ?? "",
        start: { dateTime: startTime.toISOString() },
        end: { dateTime: endTime.toISOString() },
        extendedProperties: {
          private: { contactId, source: "switchboard" },
        },
      };

      const response = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Google Calendar API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        id: string;
        status: string;
        summary: string;
      };

      return {
        appointmentId: data.id,
        contactId,
        providerId: calId,
        startTime,
        endTime,
        status: "scheduled" as const,
        serviceType: null,
        notes: notes ?? title,
      };
    });
  }

  async cancelAppointment(
    calendarId: string,
    appointmentId: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    return this.call(async () => {
      const calId = calendarId || this.config.calendarId;
      const response = await fetch(
        `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(appointmentId)}`,
        {
          method: "DELETE",
          headers: this.authHeaders(),
        },
      );

      if (!response.ok && response.status !== 410) {
        const errorBody = await response.text();
        throw new Error(`Google Calendar API error ${response.status}: ${errorBody}`);
      }

      return { success: true, previousStatus: "scheduled" };
    });
  }

  async rescheduleAppointment(
    calendarId: string,
    appointmentId: string,
    newStartTime: Date,
    newEndTime: Date,
  ): Promise<AppointmentDetails> {
    return this.call(async () => {
      const calId = calendarId || this.config.calendarId;
      const patch = {
        start: { dateTime: newStartTime.toISOString() },
        end: { dateTime: newEndTime.toISOString() },
      };

      const response = await fetch(
        `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(appointmentId)}`,
        {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify(patch),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Google Calendar API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        id: string;
        extendedProperties?: {
          private?: Record<string, string>;
        };
      };

      return {
        appointmentId: data.id,
        contactId: data.extendedProperties?.private?.["contactId"] ?? "unknown",
        providerId: calId,
        startTime: newStartTime,
        endTime: newEndTime,
        status: "rescheduled" as const,
        serviceType: null,
        notes: null,
      };
    });
  }

  async getAvailableSlots(
    calendarId: string,
    startDate: Date,
    endDate: Date,
    durationMinutes: number,
  ): Promise<AppointmentSlot[]> {
    return this.call(async () => {
      const calId = calendarId || this.config.calendarId;

      // Step 1: Query freebusy to get busy periods
      const freebusyResponse = await fetch(`${GCAL_BASE}/freeBusy`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          items: [{ id: calId }],
        }),
      });

      if (!freebusyResponse.ok) {
        const errorBody = await freebusyResponse.text();
        throw new Error(`Google Calendar freebusy error ${freebusyResponse.status}: ${errorBody}`);
      }

      const freebusyData = (await freebusyResponse.json()) as {
        calendars: Record<
          string,
          {
            busy: Array<{ start: string; end: string }>;
          }
        >;
      };

      const busyPeriods = freebusyData.calendars[calId]?.busy ?? [];

      // Step 2: Compute available slots by subtracting busy periods
      // Work hours: 9 AM - 5 PM, slot duration as specified
      const slots: AppointmentSlot[] = [];
      const durationMs = durationMinutes * 60 * 1000;
      const current = new Date(startDate);

      while (current < endDate) {
        const hour = current.getHours();
        // Only consider working hours (9 AM - 5 PM)
        if (hour >= 9 && hour < 17) {
          const slotEnd = new Date(current.getTime() + durationMs);
          if (
            slotEnd.getHours() <= 17 ||
            (slotEnd.getHours() === 17 && slotEnd.getMinutes() === 0)
          ) {
            const isBusy = busyPeriods.some((busy) => {
              const busyStart = new Date(busy.start).getTime();
              const busyEnd = new Date(busy.end).getTime();
              return current.getTime() < busyEnd && slotEnd.getTime() > busyStart;
            });

            slots.push({
              startTime: new Date(current),
              endTime: slotEnd,
              providerId: calId,
              available: !isBusy,
            });
          }
          current.setTime(current.getTime() + durationMs);
        } else if (hour < 9) {
          current.setHours(9, 0, 0, 0);
        } else {
          // Move to next day at 9 AM
          current.setDate(current.getDate() + 1);
          current.setHours(9, 0, 0, 0);
        }
      }

      return slots;
    });
  }

  async checkHealth(): Promise<PlatformHealth> {
    const start = Date.now();
    try {
      const calId = this.config.calendarId || "primary";
      const response = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}`, {
        method: "GET",
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        return {
          status: "disconnected",
          latencyMs: Date.now() - start,
          error: `Google Calendar returned ${response.status}`,
        };
      }

      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
      };
    } catch (err) {
      return {
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Mock Google Calendar provider for development/testing.
 */
export class MockGoogleCalendarProvider implements CalendarProvider {
  readonly platform = "mock" as const;

  async bookAppointment(
    calendarId: string,
    contactId: string,
    startTime: Date,
    endTime: Date,
    title: string,
    notes?: string,
  ): Promise<AppointmentDetails> {
    return {
      appointmentId: `gcal-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contactId,
      providerId: calendarId,
      startTime,
      endTime,
      status: "scheduled" as const,
      serviceType: null,
      notes: notes ?? title,
    };
  }

  async cancelAppointment(
    _calendarId: string,
    _appointmentId: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    return { success: true, previousStatus: "scheduled" };
  }

  async rescheduleAppointment(
    calendarId: string,
    appointmentId: string,
    newStartTime: Date,
    newEndTime: Date,
  ): Promise<AppointmentDetails> {
    return {
      appointmentId,
      contactId: "unknown",
      providerId: calendarId,
      startTime: newStartTime,
      endTime: newEndTime,
      status: "rescheduled" as const,
      serviceType: null,
      notes: null,
    };
  }

  async getAvailableSlots(
    _calendarId: string,
    _startDate: Date,
    _endDate: Date,
    _durationMinutes: number,
  ): Promise<AppointmentSlot[]> {
    return [];
  }

  async checkHealth(): Promise<PlatformHealth> {
    return { status: "connected", latencyMs: 1, error: null };
  }
}

/**
 * Factory: auto-detect real Google Calendar credentials.
 */
export function createGoogleCalendarProvider(config: GoogleCalendarConfig): CalendarProvider {
  const isReal =
    config.accessToken && config.accessToken.length >= 20 && !config.accessToken.includes("mock");

  if (isReal) {
    return new GoogleCalendarProvider(config);
  }

  return new MockGoogleCalendarProvider();
}
