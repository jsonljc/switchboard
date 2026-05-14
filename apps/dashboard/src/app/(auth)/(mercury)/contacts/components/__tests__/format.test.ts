import { describe, expect, it } from "vitest";

import { formatSGD, formatSGDCompact, pluralize, relTime } from "../format";

// Inputs are CENTS (verified 2026-05-14; see format.ts header comment).
describe("formatSGD", () => {
  it("formats whole-dollar SGD with thousands separator", () => {
    expect(formatSGD(168000)).toBe("S$1,680");
  });

  it("rounds half-dollars to whole dollars", () => {
    expect(formatSGD(150)).toBe("S$2"); // 1.50 → 2
  });

  it("renders em-dash for null", () => {
    expect(formatSGD(null)).toBe("—");
  });

  it("renders em-dash for zero by default", () => {
    expect(formatSGD(0)).toBe("—");
  });

  it("renders zero when forceZero is set", () => {
    expect(formatSGD(0, { forceZero: true })).toBe("S$0");
  });
});

describe("formatSGD currency unit lock (Guardrail 3)", () => {
  // Regression guard: if a future schema change reinterprets the field, this fires
  // before the visual regression does. The fixture price `Hydrafacial · single
  // session` is 28000 cents = S$280; we lock that mapping here.
  it("treats estimatedValue=28000 (Hydrafacial cents) as S$280", () => {
    expect(formatSGD(28000)).toBe("S$280");
  });

  it("treats estimatedValue=320000 (CoolSculpting abdomen cents) as S$3,200", () => {
    expect(formatSGD(320000)).toBe("S$3,200");
  });
});

describe("formatSGDCompact", () => {
  it("uses k suffix for values >= S$10k", () => {
    expect(formatSGDCompact(1680000)).toBe("S$16.8k"); // 16,800 → 16.8k
  });

  it("drops the decimal when round thousands", () => {
    expect(formatSGDCompact(1500000)).toBe("S$15k");
  });

  it("uses full digits below S$10k", () => {
    expect(formatSGDCompact(960000)).toBe("S$9,600");
  });

  it("returns null for null input", () => {
    expect(formatSGDCompact(null)).toBeNull();
  });
});

describe("relTime", () => {
  const NOW = new Date("2026-05-13T12:00:00.000Z");

  it("renders 'just now' for < 1 minute", () => {
    expect(relTime("2026-05-13T11:59:30.000Z", NOW)).toBe("just now");
  });

  it("renders Nm ago for minutes", () => {
    expect(relTime("2026-05-13T11:30:00.000Z", NOW)).toBe("30m ago");
  });

  it("renders Nh ago for hours", () => {
    expect(relTime("2026-05-13T08:00:00.000Z", NOW)).toBe("4h ago");
  });

  it("renders Nd ago for days", () => {
    expect(relTime("2026-05-10T12:00:00.000Z", NOW)).toBe("3d ago");
  });

  it("renders Nmo ago for months", () => {
    expect(relTime("2026-03-13T12:00:00.000Z", NOW)).toBe("2mo ago");
  });

  it("renders em-dash for invalid input", () => {
    expect(relTime("not-a-date", NOW)).toBe("—");
  });
});

describe("pluralize", () => {
  it("uses singular for n=1", () => {
    expect(pluralize(1, "opportunity", "opportunities")).toBe("opportunity");
  });

  it("uses plural for n=0", () => {
    expect(pluralize(0, "opportunity", "opportunities")).toBe("opportunities");
  });

  it("uses plural for n>1", () => {
    expect(pluralize(5, "opportunity", "opportunities")).toBe("opportunities");
  });
});
