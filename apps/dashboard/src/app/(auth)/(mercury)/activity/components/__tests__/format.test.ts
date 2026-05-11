import { describe, it, expect, vi, afterEach } from "vitest";
import { formatCell, formatDrawer, truncate, hashPrefix } from "../format.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spy on Intl.DateTimeFormat to control the resolved timezone. */
function mockBrowserTz(tz: string) {
  const original = Intl.DateTimeFormat;
  vi.spyOn(globalThis.Intl, "DateTimeFormat").mockImplementation(
    (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) => {
      const instance = new original(locales, options);
      // Only override resolvedOptions when called with no args (the browser-tz probe)
      if (!locales && !options) {
        const orig = instance.resolvedOptions.bind(instance);
        instance.resolvedOptions = () => ({ ...orig(), timeZone: tz });
      }
      return instance;
    },
  );
}

// ---------------------------------------------------------------------------
// formatCell
// ---------------------------------------------------------------------------

describe("formatCell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses org-tz when provided", () => {
    const iso = "2026-05-10T14:23:51.420Z";
    // UTC+0 result
    const utcResult = formatCell(iso, "UTC");
    // America/New_York is UTC-4 in May (EDT)
    const nyResult = formatCell(iso, "America/New_York");
    // The two results should differ (different timezone offset)
    expect(utcResult).not.toBe(nyResult);
    // UTC should show 14:23
    expect(utcResult).toContain("14:23");
    // New York (EDT = UTC-4) should show 10:23
    expect(nyResult).toContain("10:23");
  });

  it("falls back to browser-tz when org-tz is not provided", () => {
    mockBrowserTz("America/Chicago");
    const iso = "2026-05-10T20:00:00.000Z";
    const result = formatCell(iso);
    // America/Chicago is UTC-5 in May (CDT = UTC-5), 20:00 UTC → 15:00 CDT
    expect(result).toContain("15:00");
  });

  it("falls back to UTC when browser-tz resolves to empty string", () => {
    // Simulate a broken Intl where resolvedOptions returns no timezone.
    // We must capture OriginalDTF before spying to avoid infinite recursion.
    const OriginalDTF = Intl.DateTimeFormat;
    vi.spyOn(globalThis.Intl, "DateTimeFormat").mockImplementation(
      (_locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) => {
        const instance = new OriginalDTF("en-US", options);
        // Only stub resolvedOptions on the no-arg (browser-tz probe) call
        if (!_locales && !options) {
          instance.resolvedOptions = () =>
            ({
              locale: "en-US",
              calendar: "gregory",
              numberingSystem: "latn",
              timeZone: "",
            }) as Intl.ResolvedDateTimeFormatOptions;
        }
        return instance;
      },
    );
    const iso = "2026-05-10T14:23:51.420Z";
    const result = formatCell(iso);
    // Should fall through to UTC: 14:23
    expect(result).toContain("14:23");
  });

  it("returns '—' for an invalid timestamp", () => {
    expect(formatCell("not-a-date")).toBe("—");
    expect(formatCell("")).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// formatDrawer
// ---------------------------------------------------------------------------

describe("formatDrawer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the full ISO string with a timezone abbreviation appended", () => {
    const iso = "2026-05-10T14:23:51.420Z";
    const result = formatDrawer(iso, "UTC");
    // Must start with the exact ISO string
    expect(result).toMatch(/^2026-05-10T14:23:51\.420Z/);
    // Must end with a parenthesised tz abbreviation
    expect(result).toMatch(/\(UTC\)$/);
  });

  it("appends the correct abbreviation for a non-UTC timezone", () => {
    const iso = "2026-05-10T14:23:51.420Z";
    // America/Los_Angeles in May = PDT
    const result = formatDrawer(iso, "America/Los_Angeles");
    expect(result).toMatch(/^2026-05-10T14:23:51\.420Z/);
    expect(result).toMatch(/\((PDT|GMT[+-]\d+)\)$/);
  });

  it("uses browser-tz when no org-tz is provided", () => {
    mockBrowserTz("UTC");
    const iso = "2026-05-10T14:23:51.420Z";
    const result = formatDrawer(iso);
    expect(result).toContain("(UTC)");
  });

  it("returns '—' for an invalid timestamp", () => {
    expect(formatDrawer("not-a-date")).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("returns the input unchanged when its length is less than n", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("returns the input unchanged when its length equals n", () => {
    expect(truncate("exact", 5)).toBe("exact");
  });

  it("returns the first n characters when the string is longer than n", () => {
    expect(truncate("agent_alex_001", 8)).toBe("agent_al");
  });

  it("returns '' for an empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  it("handles n=0 by returning empty string", () => {
    expect(truncate("something", 0)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// hashPrefix
// ---------------------------------------------------------------------------

describe("hashPrefix", () => {
  it("returns 'HASH:' plus the first 8 characters of the hash", () => {
    const hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    expect(hashPrefix(hash)).toBe("HASH:a1b2c3d4");
  });

  it("returns 'HASH:' for an empty string", () => {
    expect(hashPrefix("")).toBe("HASH:");
  });

  it("returns 'HASH:' plus the full string when hash is shorter than 8 chars", () => {
    expect(hashPrefix("abc")).toBe("HASH:abc");
  });

  it("handles fixture hash from ACTIVITY_FIXTURES correctly", () => {
    // from fixtures.ts entryHash of first row
    const h = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b";
    expect(hashPrefix(h)).toBe("HASH:1a2b3c4d");
  });
});
