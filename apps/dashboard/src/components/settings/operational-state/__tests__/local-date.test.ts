import { describe, it, expect } from "vitest";
import {
  ensureTimeZone,
  instantToInclusiveEndDate,
  instantToLocalDate,
  localDateToInstant,
} from "../local-date";

describe("localDateToInstant", () => {
  it("converts a start date to local midnight in the org timezone (Asia/Singapore, UTC+8)", () => {
    expect(localDateToInstant("2026-06-01", "Asia/Singapore", "start")).toBe(
      "2026-05-31T16:00:00.000Z",
    );
  });

  it("converts an INCLUSIVE end date to the start of the NEXT local day (half-open interval)", () => {
    // Promo "June 1-15" covers all of June 15 SGT; end = June 16 00:00 SGT.
    expect(localDateToInstant("2026-06-15", "Asia/Singapore", "end")).toBe(
      "2026-06-15T16:00:00.000Z",
    );
  });

  it("a single-day window yields end strictly after start (satisfies the 4a schema refine)", () => {
    const start = localDateToInstant("2026-06-01", "Asia/Singapore", "start");
    const end = localDateToInstant("2026-06-01", "Asia/Singapore", "end");
    expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
  });

  it("handles UTC", () => {
    expect(localDateToInstant("2026-06-01", "UTC", "start")).toBe("2026-06-01T00:00:00.000Z");
    expect(localDateToInstant("2026-06-01", "UTC", "end")).toBe("2026-06-02T00:00:00.000Z");
  });

  it("handles a DST spring-forward boundary (America/New_York, 2025-03-09)", () => {
    // Midnight Mar 9 is still EST (UTC-5); midnight Mar 10 is EDT (UTC-4).
    expect(localDateToInstant("2025-03-09", "America/New_York", "start")).toBe(
      "2025-03-09T05:00:00.000Z",
    );
    expect(localDateToInstant("2025-03-09", "America/New_York", "end")).toBe(
      "2025-03-10T04:00:00.000Z",
    );
  });

  it("rejects a malformed date string", () => {
    expect(() => localDateToInstant("june 1", "Asia/Singapore", "start")).toThrow();
    expect(() => localDateToInstant("2026-6-1", "Asia/Singapore", "start")).toThrow();
  });
});

describe("instantToLocalDate / instantToInclusiveEndDate", () => {
  it("renders an instant as the local date in the org timezone", () => {
    expect(instantToLocalDate("2026-05-31T16:00:00.000Z", "Asia/Singapore")).toBe("2026-06-01");
  });

  it("round-trips a start date", () => {
    const instant = localDateToInstant("2026-06-01", "Asia/Singapore", "start");
    expect(instantToLocalDate(instant, "Asia/Singapore")).toBe("2026-06-01");
  });

  it("recovers the INCLUSIVE end date from an exclusive end instant", () => {
    const instant = localDateToInstant("2026-06-15", "Asia/Singapore", "end");
    expect(instantToInclusiveEndDate(instant, "Asia/Singapore")).toBe("2026-06-15");
  });
});

describe("ensureTimeZone", () => {
  it("passes a valid IANA zone through", () => {
    expect(ensureTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to Asia/Singapore for missing or invalid zones (mirrors the alex builder)", () => {
    expect(ensureTimeZone(undefined)).toBe("Asia/Singapore");
    expect(ensureTimeZone("")).toBe("Asia/Singapore");
    expect(ensureTimeZone("Mars/Olympus_Mons")).toBe("Asia/Singapore");
  });

  it("conversion entry points harden invalid zones to the fallback instead of throwing", () => {
    // Asia/Singapore fallback: June 1 local midnight is May 31 16:00 UTC.
    expect(localDateToInstant("2026-06-01", "Mars/Olympus_Mons", "start")).toBe(
      "2026-05-31T16:00:00.000Z",
    );
    expect(instantToLocalDate("2026-05-31T16:00:00.000Z", "Mars/Olympus_Mons")).toBe("2026-06-01");
  });
});
