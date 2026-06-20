import { describe, expect, it } from "vitest";
import { formatCents, relativeTime } from "@/components/agent-panel/lib/format";

describe("formatCents", () => {
  it("divides by 100, renders S$ (SGD), and never raw cents", () => {
    expect(formatCents(142000)).toBe("S$1,420");
    expect(formatCents(3500)).toBe("S$35");
    expect(formatCents(4438)).toBe("S$44.38");
  });
  it("preserves cents for non-whole amounts at any magnitude", () => {
    // The legacy rule shows 2dp whenever the amount is not a whole dollar, at
    // every magnitude. The canonical formatter's "auto" mode would round a
    // >= S$1,000 value, so this pins the byte-identical pre-#6b behaviour
    // (only the symbol changed: USD $ -> SGD S$).
    expect(formatCents(142050)).toBe("S$1,420.50");
  });
  it("returns null for null (never coerces to S$0)", () => {
    expect(formatCents(null)).toBeNull();
  });
  it("renders a true zero as S$0", () => {
    expect(formatCents(0)).toBe("S$0");
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
