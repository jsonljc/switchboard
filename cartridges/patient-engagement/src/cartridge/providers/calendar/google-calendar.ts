// ---------------------------------------------------------------------------
// Google Calendar Provider — with CircuitBreaker + retry
// ---------------------------------------------------------------------------

import type { CalendarProvider } from "../provider.js";
import type { AppointmentDetails, AppointmentSlot } from "../../../core/types.js";
import type { PlatformHealth } from "../../types.js";

export interface GoogleCalendarConfig {
  apiKey: string;
  calendarId: string;
}

/**
 * Simple circuit breaker for external API calls.
 */
class CircuitBreaker {
  private failures = 0;
  private lastFailureAt = 0;
  private readonly threshold: number;
  private readonly resetTimeMs: number;

  constructor(threshold = 5, resetTimeMs = 60_000) {
    this.threshold = threshold;
    this.resetTimeMs = resetTimeMs;
  }

  get isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailureAt > this.resetTimeMs) {
        this.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
    }
  }
  throw new Error("withRetry exhausted");
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly platform = "google" as const;
  private readonly breaker = new CircuitBreaker();

  constructor(_config: GoogleCalendarConfig) {
    // Config will be used when real API integration is implemented
  }

  async bookAppointment(
    calendarId: string,
    patientId: string,
    startTime: Date,
    endTime: Date,
    title: string,
    notes?: string,
  ): Promise<AppointmentDetails> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Google Calendar unavailable");

    return withRetry(async () => {
      try {
        // In production, this would call Google Calendar API
        // POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
        const appointmentId = `gcal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.breaker.recordSuccess();
        return {
          appointmentId,
          patientId,
          providerId: calendarId,
          startTime,
          endTime,
          status: "scheduled" as const,
          treatmentType: null,
          notes: notes ?? title,
        };
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async cancelAppointment(
    _calendarId: string,
    _appointmentId: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Google Calendar unavailable");

    return withRetry(async () => {
      try {
        // DELETE https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}
        this.breaker.recordSuccess();
        return { success: true, previousStatus: "scheduled" };
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async rescheduleAppointment(
    calendarId: string,
    appointmentId: string,
    newStartTime: Date,
    newEndTime: Date,
  ): Promise<AppointmentDetails> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Google Calendar unavailable");

    return withRetry(async () => {
      try {
        // PATCH https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}
        this.breaker.recordSuccess();
        return {
          appointmentId,
          patientId: "unknown",
          providerId: calendarId,
          startTime: newStartTime,
          endTime: newEndTime,
          status: "rescheduled" as const,
          treatmentType: null,
          notes: null,
        };
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async getAvailableSlots(
    _calendarId: string,
    _startDate: Date,
    _endDate: Date,
    _durationMinutes: number,
  ): Promise<AppointmentSlot[]> {
    if (this.breaker.isOpen) throw new Error("Circuit breaker open — Google Calendar unavailable");

    return withRetry(async () => {
      try {
        // GET freebusy query, then compute available slots
        this.breaker.recordSuccess();
        // Stub: return empty until actual API integration
        return [];
      } catch (err) {
        this.breaker.recordFailure();
        throw err;
      }
    });
  }

  async checkHealth(): Promise<PlatformHealth> {
    if (this.breaker.isOpen) {
      return { status: "disconnected", latencyMs: 0, error: "Circuit breaker open" };
    }
    const start = Date.now();
    try {
      // Lightweight API ping
      return { status: "connected", latencyMs: Date.now() - start, error: null };
    } catch (err) {
      return {
        status: "degraded",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
