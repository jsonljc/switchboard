import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AmbientCream } from "../ambient-cream";

describe("AmbientCream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets --ambient-cream on mount", () => {
    render(<AmbientCream />);
    const v = document.documentElement.style.getPropertyValue("--ambient-cream");
    expect(v).toMatch(/^hsl/);
  });

  it("re-applies on a 60-second interval", () => {
    render(<AmbientCream />);
    const initial = document.documentElement.style.getPropertyValue("--ambient-cream");
    vi.setSystemTime(new Date("2026-05-04T19:00:00Z"));
    vi.advanceTimersByTime(60_000);
    const after = document.documentElement.style.getPropertyValue("--ambient-cream");
    expect(after).not.toBe(initial);
  });
});
