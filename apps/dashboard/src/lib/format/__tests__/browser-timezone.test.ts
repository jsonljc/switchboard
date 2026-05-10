import { afterEach, describe, expect, it, vi } from "vitest";
import { browserTimezone } from "../browser-timezone";

describe("browserTimezone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the IANA zone reported by Intl.DateTimeFormat", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "America/Los_Angeles" }),
    } as unknown as Intl.DateTimeFormat);

    expect(browserTimezone()).toBe("America/Los_Angeles");
  });

  it("falls back to UTC when Intl.DateTimeFormat throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("nope");
    });

    expect(browserTimezone()).toBe("UTC");
  });

  it("falls back to UTC when resolvedOptions returns no timeZone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "" }),
    } as unknown as Intl.DateTimeFormat);

    expect(browserTimezone()).toBe("UTC");
  });
});
