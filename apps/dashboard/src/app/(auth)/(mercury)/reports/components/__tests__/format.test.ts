import { describe, expect, it } from "vitest";
import { fmtSGD, fmtPct, fmtInt } from "../format";

describe("fmtSGD", () => {
  it("auto: no cents when abs >= 1000", () => {
    expect(fmtSGD(14720)).toBe("S$14,720");
    expect(fmtSGD(1000)).toBe("S$1,000");
  });

  it("auto: no cents when abs < 1000 but integer", () => {
    expect(fmtSGD(500)).toBe("S$500");
    expect(fmtSGD(612)).toBe("S$612");
  });

  it("auto: cents when abs < 1000 and fractional", () => {
    expect(fmtSGD(447.75)).toBe("S$447.75");
    expect(fmtSGD(47.5)).toBe("S$47.50");
  });

  it('honors withCents: "always"', () => {
    expect(fmtSGD(447.75, { withCents: "always" })).toBe("S$447.75");
    expect(fmtSGD(500, { withCents: "always" })).toBe("S$500.00");
  });

  it('honors withCents: "never"', () => {
    expect(fmtSGD(14720.42, { withCents: "never" })).toBe("S$14,720");
    expect(fmtSGD(47.5, { withCents: "never" })).toBe("S$48");
  });

  it("returns em-dash for null", () => {
    expect(fmtSGD(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(fmtSGD(undefined)).toBe("—");
  });

  it("compact: renders k for >= 10,000", () => {
    expect(fmtSGD(28402, { compact: true })).toBe("S$28k");
  });

  it("compact: renders m for >= 1,000,000", () => {
    expect(fmtSGD(1_500_000, { compact: true })).toBe("S$1.5m");
  });

  it("never emits a bare $", () => {
    for (const v of [0, 1, 99.99, 100, 9999, 10_000, 999_999, 1_234_567]) {
      const out = fmtSGD(v);
      expect(out.startsWith("S$") || out.startsWith("-S$") || out === "S$0").toBe(true);
    }
  });

  it("formats zero as S$0", () => {
    expect(fmtSGD(0)).toBe("S$0");
  });

  it("negative dollars: leading -", () => {
    expect(fmtSGD(-200)).toBe("-S$200");
    expect(fmtSGD(-2000)).toBe("-S$2,000");
  });
});

describe("fmtInt", () => {
  it("formats with en-SG grouping", () => {
    expect(fmtInt(1234567)).toBe("1,234,567");
  });
  it("returns em-dash for null", () => {
    expect(fmtInt(null)).toBe("—");
  });
});

describe("fmtPct", () => {
  it("formats with two decimals by default", () => {
    expect(fmtPct(0.0133)).toBe("1.33%");
  });
  it("respects digits arg", () => {
    expect(fmtPct(0.0478, 1)).toBe("4.8%");
  });
  it("returns em-dash for null", () => {
    expect(fmtPct(null)).toBe("—");
  });
});
