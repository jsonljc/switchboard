import { describe, it, expect } from "vitest";
import {
  describeCalendarReadiness,
  hasRuntimeEligibleBusinessHours,
} from "../calendar-readiness.js";

describe("hasRuntimeEligibleBusinessHours", () => {
  it("returns false for null", () => {
    expect(hasRuntimeEligibleBusinessHours(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasRuntimeEligibleBusinessHours(undefined)).toBe(false);
  });

  it("returns true for empty object (matches current runtime threshold)", () => {
    expect(hasRuntimeEligibleBusinessHours({})).toBe(true);
  });

  it("returns true for populated object", () => {
    expect(hasRuntimeEligibleBusinessHours({ mon: [{ start: "09:00", end: "17:00" }] })).toBe(true);
  });

  it("returns false for array (slightly stricter than runtime)", () => {
    expect(hasRuntimeEligibleBusinessHours([])).toBe(false);
    expect(hasRuntimeEligibleBusinessHours([{ start: "09:00" }])).toBe(false);
  });

  it("returns false for primitive types", () => {
    expect(hasRuntimeEligibleBusinessHours("string")).toBe(false);
    expect(hasRuntimeEligibleBusinessHours(42)).toBe(false);
    expect(hasRuntimeEligibleBusinessHours(true)).toBe(false);
  });
});

describe("describeCalendarReadiness", () => {
  it("returns google state when both Google env vars are set", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: true,
      hasGoogleCalendarId: true,
      businessHours: null,
    });
    expect(result.state).toBe("google");
    expect(result.check).toEqual({
      id: "calendar",
      label: "Calendar",
      status: "pass",
      blocking: false,
      message:
        "Google Calendar configuration detected. Bookings should create real calendar events.",
    });
  });

  it("falls through to local when only Google credentials are set (calendar id missing)", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: true,
      hasGoogleCalendarId: false,
      businessHours: { mon: [] },
    });
    expect(result.state).toBe("local");
    expect(result.check.status).toBe("pass");
  });

  it("falls through to unconfigured when only Google calendar id is set and no businessHours", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: true,
      businessHours: null,
    });
    expect(result.state).toBe("unconfigured");
    expect(result.check.status).toBe("fail");
  });

  it("returns local state when no Google env and businessHours is an object", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
    });
    expect(result.check).toEqual({
      id: "calendar",
      label: "Calendar",
      status: "pass",
      blocking: false,
      message: "Local business hours detected. Bookings may not create external calendar events.",
    });
  });

  it("returns local state for empty-object businessHours (runtime-parity)", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: {},
    });
    expect(result.state).toBe("local");
  });

  it("returns unconfigured when no Google env and businessHours is null", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: null,
    });
    expect(result.state).toBe("unconfigured");
    expect(result.check).toEqual({
      id: "calendar",
      label: "Calendar",
      status: "fail",
      blocking: false,
      message: "Calendar not configured. Booking flows may fall back to stub behavior.",
    });
  });

  it("returns unconfigured when businessHours is an array (array guard)", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: [],
    });
    expect(result.state).toBe("unconfigured");
    expect(result.check.status).toBe("fail");
  });

  it("always returns check.id === 'calendar' and check.blocking === false", () => {
    const inputs = [
      { hasGoogleCredentials: true, hasGoogleCalendarId: true, businessHours: null },
      { hasGoogleCredentials: false, hasGoogleCalendarId: false, businessHours: {} },
      { hasGoogleCredentials: false, hasGoogleCalendarId: false, businessHours: null },
    ] as const;
    for (const input of inputs) {
      const result = describeCalendarReadiness(input);
      expect(result.check.id).toBe("calendar");
      expect(result.check.blocking).toBe(false);
    }
  });
});
