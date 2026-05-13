import { describe, it, expect } from "vitest";
import { formatRemaining, timerLevel } from "../format";

describe("formatRemaining", () => {
  it("returns 'expired' when ms <= 0", () => {
    expect(formatRemaining(0)).toBe("expired");
    expect(formatRemaining(-1)).toBe("expired");
  });
  it("formats seconds under a minute", () => {
    expect(formatRemaining(45_000)).toBe("45s");
  });
  it("formats minutes and seconds under an hour", () => {
    expect(formatRemaining(2 * 60_000 + 14_000)).toBe("2m 14s");
  });
  it("formats hours and minutes at an hour or more", () => {
    expect(formatRemaining(3 * 3_600_000 + 22 * 60_000)).toBe("3h 22m");
  });
  it("formats a single second", () => {
    expect(formatRemaining(1_000)).toBe("1s");
  });
  it("formats 59 seconds as seconds, not minutes", () => {
    expect(formatRemaining(59_000)).toBe("59s");
  });
});

describe("timerLevel", () => {
  it("returns 'expired' at or below zero", () => {
    expect(timerLevel(0)).toBe("expired");
  });
  it("returns 'critical' under 5 minutes", () => {
    expect(timerLevel(4 * 60_000)).toBe("critical");
  });
  it("returns 'warn' under 1 hour", () => {
    expect(timerLevel(30 * 60_000)).toBe("warn");
  });
  it("returns 'normal' over 1 hour", () => {
    expect(timerLevel(2 * 3_600_000)).toBe("normal");
  });
  it("returns 'expired' for negative ms", () => {
    expect(timerLevel(-1)).toBe("expired");
  });
  it("returns 'warn' at exactly 5 minutes", () => {
    expect(timerLevel(5 * 60_000)).toBe("warn");
  });
  it("returns 'normal' at exactly 1 hour", () => {
    expect(timerLevel(60 * 60_000)).toBe("normal");
  });
});
