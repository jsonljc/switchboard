// apps/dashboard/src/lib/cockpit/__tests__/relative-age.test.ts
import { describe, it, expect } from "vitest";
import { relativeAge } from "../relative-age";

const NOW = new Date("2026-05-14T12:00:00Z");

describe("relativeAge", () => {
  it("returns 'just now' for < 60s ago", () => {
    expect(relativeAge(new Date("2026-05-14T11:59:30Z"), NOW)).toBe("just now");
  });
  it("returns N min ago for < 1h", () => {
    expect(relativeAge(new Date("2026-05-14T11:56:00Z"), NOW)).toBe("4 min ago");
  });
  it("returns N h ago for < 24h", () => {
    expect(relativeAge(new Date("2026-05-14T08:00:00Z"), NOW)).toBe("4 h ago");
  });
  it("returns 'Yesterday' for < 48h", () => {
    expect(relativeAge(new Date("2026-05-13T12:00:00Z"), NOW)).toBe("Yesterday");
  });
  it("returns weekday for < 7d", () => {
    expect(relativeAge(new Date("2026-05-09T12:00:00Z"), NOW)).toBe("Sat");
  });
  it("returns ISO date for older", () => {
    expect(relativeAge(new Date("2026-04-01T12:00:00Z"), NOW)).toBe("2026-04-01");
  });
});
