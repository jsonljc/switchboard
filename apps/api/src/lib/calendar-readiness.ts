import type { ReadinessCheck } from "../routes/readiness.js";

export type CalendarReadinessState = "google" | "local" | "unconfigured";

export interface CalendarReadinessInput {
  hasGoogleCredentials: boolean;
  hasGoogleCalendarId: boolean;
  businessHours: unknown;
}

export interface CalendarReadinessResult {
  state: CalendarReadinessState;
  check: ReadinessCheck;
}

const MESSAGES = {
  google: "Google Calendar configuration detected. Bookings should create real calendar events.",
  local: "Local business hours detected. Bookings may not create external calendar events.",
  unconfigured: "Calendar not configured. Booking flows may fall back to stub behavior.",
} as const;

export function hasRuntimeEligibleBusinessHours(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function makeCheck(status: "pass" | "fail", message: string): ReadinessCheck {
  return { id: "calendar", label: "Calendar", status, blocking: false, message };
}

export function describeCalendarReadiness(input: CalendarReadinessInput): CalendarReadinessResult {
  if (input.hasGoogleCredentials && input.hasGoogleCalendarId) {
    return { state: "google", check: makeCheck("pass", MESSAGES.google) };
  }

  if (hasRuntimeEligibleBusinessHours(input.businessHours)) {
    return { state: "local", check: makeCheck("pass", MESSAGES.local) };
  }

  return { state: "unconfigured", check: makeCheck("fail", MESSAGES.unconfigured) };
}
