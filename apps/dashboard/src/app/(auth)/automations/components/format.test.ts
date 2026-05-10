import { describe, it, expect } from "vitest";
import {
  formatShortDate,
  formatFullIso,
  resolveTimezone,
  truncateWorkflowId,
  redactedKeyLabel,
} from "./format";

describe("format helpers", () => {
  describe("resolveTimezone", () => {
    it("returns the org timezone when provided", () => {
      expect(resolveTimezone("Asia/Singapore")).toBe("Asia/Singapore");
    });

    it("falls back to browser timezone when org tz is null/undefined", () => {
      const tz = resolveTimezone(undefined);
      expect(typeof tz).toBe("string");
      expect(tz.length).toBeGreaterThan(0);
    });
  });

  describe("formatShortDate", () => {
    it("renders a short month-day in the resolved timezone", () => {
      const out = formatShortDate("2026-05-09T18:00:00Z", "Asia/Singapore");
      expect(out).toMatch(/May\s+10/);
    });

    it("falls back to em-dash on bad input", () => {
      expect(formatShortDate("not-a-date", "UTC")).toBe("—");
    });
  });

  describe("formatFullIso", () => {
    it("emits ISO8601 with offset for the resolved zone", () => {
      const out = formatFullIso("2026-05-09T10:00:00Z", "Asia/Singapore");
      expect(out).toMatch(/2026-05-09T18:00:00.*\+08:00/);
    });

    it("falls back to em-dash on bad input", () => {
      expect(formatFullIso("nonsense", "UTC")).toBe("—");
    });
  });

  describe("truncateWorkflowId", () => {
    it("renders WF:<first 8 chars> when present", () => {
      expect(truncateWorkflowId("a1b2c3d4-rest-of-uuid")).toBe("WF:a1b2c3d4");
    });

    it("renders em-dash when null", () => {
      expect(truncateWorkflowId(null)).toBe("—");
    });
  });

  describe("redactedKeyLabel", () => {
    it("returns nothing when count is 0", () => {
      expect(redactedKeyLabel(0)).toBe("");
    });

    it("returns ' · N redacted' when count > 0", () => {
      expect(redactedKeyLabel(3)).toBe(" · 3 redacted");
    });
  });
});
