import { describe, expect, it } from "vitest";
import { relativeTime, dueIn, undoableFor } from "../time";

const NOW = new Date("2026-05-26T12:00:00.000Z").getTime();

function ago(min: number): string {
  return new Date(NOW - min * 60000).toISOString();
}
function ahead(min: number): string {
  return new Date(NOW + min * 60000).toISOString();
}

describe("relativeTime", () => {
  it("returns empty string for absent input", () => {
    expect(relativeTime(undefined, NOW)).toBe("");
  });

  it("reads 'just now' under a minute", () => {
    expect(relativeTime(ago(0), NOW)).toBe("just now");
  });

  it("reads minutes within the hour", () => {
    expect(relativeTime(ago(5), NOW)).toBe("5m ago");
  });

  it("reads hours within the day", () => {
    expect(relativeTime(ago(150), NOW)).toBe("3h ago");
  });

  it("reads days beyond 24h", () => {
    expect(relativeTime(ago(60 * 24 * 2), NOW)).toBe("2d ago");
  });
});

describe("dueIn", () => {
  it("returns null when no deadline", () => {
    expect(dueIn(undefined, NOW)).toBeNull();
  });

  it("reads Overdue (soon) for a past deadline", () => {
    expect(dueIn(ago(10), NOW)).toEqual({ label: "Overdue", state: "soon" });
  });

  it("flags soon under 30 minutes", () => {
    expect(dueIn(ahead(15), NOW)).toEqual({ label: "Due in 15m", state: "soon" });
  });

  it("is normal between 30 and 60 minutes", () => {
    expect(dueIn(ahead(45), NOW)).toEqual({ label: "Due in 45m", state: "normal" });
  });

  it("is soon at one hour out", () => {
    expect(dueIn(ahead(60), NOW)).toEqual({ label: "Due in 1h", state: "soon" });
  });

  it("is comfort at four or more hours out", () => {
    expect(dueIn(ahead(60 * 5), NOW)).toEqual({ label: "Due in 5h", state: "comfort" });
  });

  it("is normal between one and four hours out", () => {
    expect(dueIn(ahead(60 * 2), NOW)).toEqual({ label: "Due in 2h", state: "normal" });
  });
});

describe("undoableFor", () => {
  const now = Date.UTC(2026, 4, 26, 9, 0, 0);
  it("returns null for absent or past windows", () => {
    expect(undoableFor(undefined, now)).toBeNull();
    expect(undoableFor(new Date(now - 60_000).toISOString(), now)).toBeNull();
  });
  it("formats minutes and hours", () => {
    expect(undoableFor(new Date(now + 5 * 60_000).toISOString(), now)).toBe("undoable for 5m");
    expect(undoableFor(new Date(now + 2 * 3_600_000).toISOString(), now)).toBe("undoable for 2h");
  });
});
