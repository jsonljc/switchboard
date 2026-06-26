import { describe, it, expect } from "vitest";
import { parseSlotWindowOrFail } from "./slot-window.js";

describe("parseSlotWindowOrFail (P2-2)", () => {
  it("parses a valid ISO 8601 window into Dates", () => {
    const result = parseSlotWindowOrFail("2026-07-01T14:00:00Z", "2026-07-01T15:00:00Z");
    expect("window" in result).toBe(true);
    if ("window" in result) {
      expect(result.window.startsAt.toISOString()).toBe("2026-07-01T14:00:00.000Z");
      expect(result.window.endsAt.toISOString()).toBe("2026-07-01T15:00:00.000Z");
    }
  });

  it("returns a recoverable fail when slotStart is unparseable", () => {
    const result = parseSlotWindowOrFail("not-a-date", "2026-07-01T15:00:00Z");
    expect("failure" in result).toBe(true);
    if ("failure" in result) {
      expect(result.failure.status).toBe("error");
      expect(result.failure.error?.code).toBe("INVALID_SLOT");
      // a malformed date is the model's to re-issue, so steer it (retryable)
      expect(result.failure.error?.retryable).toBe(true);
      expect(result.failure.error?.modelRemediation).toBeTruthy();
    }
  });

  it("returns a recoverable fail when slotEnd is unparseable", () => {
    const result = parseSlotWindowOrFail("2026-07-01T14:00:00Z", "");
    expect("failure" in result).toBe(true);
    if ("failure" in result) {
      expect(result.failure.error?.code).toBe("INVALID_SLOT");
      expect(result.failure.error?.retryable).toBe(true);
    }
  });

  it("returns a recoverable fail when end is not after start", () => {
    const result = parseSlotWindowOrFail("2026-07-01T15:00:00Z", "2026-07-01T14:00:00Z");
    expect("failure" in result).toBe(true);
    if ("failure" in result) {
      expect(result.failure.error?.code).toBe("INVALID_SLOT");
      expect(result.failure.error?.retryable).toBe(true);
    }
  });

  it("returns a recoverable fail when end equals start (zero-length window)", () => {
    const result = parseSlotWindowOrFail("2026-07-01T14:00:00Z", "2026-07-01T14:00:00Z");
    expect("failure" in result).toBe(true);
  });
});
