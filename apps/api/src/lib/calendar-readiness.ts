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

export function describeCalendarReadiness(input: CalendarReadinessInput): CalendarReadinessResult {
  if (input.hasGoogleCredentials && input.hasGoogleCalendarId) {
    return {
      state: "google",
      check: {
        id: "calendar",
        label: "Calendar",
        status: "pass",
        blocking: false,
        message: MESSAGES.google,
      },
    };
  }

  if (hasRuntimeEligibleBusinessHours(input.businessHours)) {
    return {
      state: "local",
      check: {
        id: "calendar",
        label: "Calendar",
        status: "pass",
        blocking: false,
        message: MESSAGES.local,
      },
    };
  }

  return {
    state: "unconfigured",
    check: {
      id: "calendar",
      label: "Calendar",
      status: "fail",
      blocking: false,
      message: MESSAGES.unconfigured,
    },
  };
}
