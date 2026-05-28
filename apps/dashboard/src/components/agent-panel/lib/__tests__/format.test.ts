import { describe, expect, it } from "vitest";
import { formatCents, relativeTime } from "@/components/agent-panel/lib/format";

describe("formatCents", () => {
  it("divides by 100 and never renders raw cents", () => {
    expect(formatCents(142000)).toBe("$1,420");
    expect(formatCents(3500)).toBe("$35");
    expect(formatCents(4438)).toBe("$44.38");
  });
  it("returns null for null (never coerces to $0)", () => {
    expect(formatCents(null)).toBeNull();
  });
  it("renders a true zero as $0", () => {
    expect(formatCents(0)).toBe("$0");
  });
});

describe("relativeTime", () => {
  it("formats minutes/hours ago from a fixed now", () => {
    const now = new Date("2026-05-25T15:42:00Z").getTime();
    expect(relativeTime("2026-05-25T15:30:00Z", now)).toBe("12m ago");
    expect(relativeTime("2026-05-25T13:42:00Z", now)).toBe("2h ago");
  });
  it("returns null for null", () => {
    expect(relativeTime(null, Date.now())).toBeNull();
  });
});
