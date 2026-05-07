import { describe, expect, it } from "vitest";
import { formatRelativeAge } from "../relative-age.js";

const TZ = "Asia/Singapore";

function at(iso: string): Date {
  return new Date(iso);
}

describe("formatRelativeAge", () => {
  const now = at("2026-05-07T08:00:00+08:00"); // 8 AM Singapore on Thu

  it("renders 'just now' under 1 minute", () => {
    expect(formatRelativeAge(at("2026-05-07T07:59:30+08:00"), now, TZ)).toBe("just now");
  });

  it("renders '<n>m ago' under 1 hour", () => {
    expect(formatRelativeAge(at("2026-05-07T07:55:00+08:00"), now, TZ)).toBe("5m ago");
  });

  it("renders '<n>h ago' same calendar day", () => {
    expect(formatRelativeAge(at("2026-05-07T05:00:00+08:00"), now, TZ)).toBe("3h ago");
  });

  it("renders 'yesterday' previous calendar day", () => {
    expect(formatRelativeAge(at("2026-05-06T22:00:00+08:00"), now, TZ)).toBe("yesterday");
  });

  it("renders '<n>d ago' within trailing week", () => {
    expect(formatRelativeAge(at("2026-05-04T08:00:00+08:00"), now, TZ)).toBe("3d ago");
  });

  it("renders '<n>d ago' for older-than-week, same calendar month", () => {
    expect(formatRelativeAge(at("2026-04-25T08:00:00+08:00"), now, TZ)).toBe("12d ago");
  });

  it("renders 'Mon Day' for older than current calendar month", () => {
    // March 3 from May 7 — older than calendar month
    expect(formatRelativeAge(at("2026-03-03T10:00:00+08:00"), now, TZ)).toBe("Mar 3");
  });

  it("treats future dates defensively as 'just now'", () => {
    expect(formatRelativeAge(at("2026-05-07T09:00:00+08:00"), now, TZ)).toBe("just now");
  });
});
