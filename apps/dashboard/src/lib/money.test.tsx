import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { formatMoney, Money } from "./money";

describe("formatMoney (canonical SGD, whole-dollar input)", () => {
  it("formats >=1000 with separators and no cents", () => {
    expect(formatMoney(14720)).toBe("S$14,720");
  });

  it("shows cents for fractional values < 1000 (auto)", () => {
    expect(formatMoney(447.75)).toBe("S$447.75");
  });

  it("omits cents for integer values < 1000 (auto)", () => {
    expect(formatMoney(280)).toBe("S$280");
  });

  it("returns an em-dash for null/undefined", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });

  it("prefixes a minus sign before the symbol for negatives", () => {
    expect(formatMoney(-200)).toBe("-S$200");
  });

  it("honors withCents always/never", () => {
    expect(formatMoney(1000, { withCents: "always" })).toBe("S$1,000.00");
    expect(formatMoney(999, { withCents: "always" })).toBe("S$999.00");
  });

  it("supports compact k/m", () => {
    expect(formatMoney(28000, { compact: true })).toBe("S$28k");
    expect(formatMoney(1234567, { compact: true })).toBe("S$1.2m");
  });
});

describe("<Money>", () => {
  it("renders the formatted value with tabular figures", () => {
    const { container } = render(<Money value={14720} />);
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("S$14,720");
    expect(span?.className).toContain("tabular-nums");
  });

  it("passes formatter options + className through", () => {
    const { container } = render(<Money value={447.75} withCents="always" className="text-lg" />);
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("S$447.75");
    expect(span?.className).toContain("text-lg");
  });
});
