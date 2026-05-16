import { describe, it, expect } from "vitest";
import {
  KIND_CONFIG,
  SETTLEMENT_LAG_HOURS,
  V1_ATTRIBUTABLE_KINDS,
  isAttributableKind,
} from "../outcome-attribution-config.js";

describe("V1_ATTRIBUTABLE_KINDS", () => {
  it("contains exactly pause and refresh_creative", () => {
    expect([...V1_ATTRIBUTABLE_KINDS].sort()).toEqual(["pause", "refresh_creative"]);
  });
});

describe("KIND_CONFIG.pause", () => {
  it("has 7d window, medium confidence, spend metric, favorable down, 5% noise floor", () => {
    expect(KIND_CONFIG.pause).toEqual({
      windowDays: 7,
      confidence: "medium",
      primaryMetric: "spend",
      favorableDirection: "down",
      noiseFloorPct: 5,
      minimumAbsoluteMovementCents: 500,
    });
  });
});

describe("KIND_CONFIG.refresh_creative", () => {
  it("has 14d window, low confidence, ctr metric, favorable up, 10% noise floor", () => {
    expect(KIND_CONFIG.refresh_creative).toEqual({
      windowDays: 14,
      confidence: "low",
      primaryMetric: "ctr",
      favorableDirection: "up",
      noiseFloorPct: 10,
    });
  });
});

describe("SETTLEMENT_LAG_HOURS", () => {
  it("is 24 hours", () => {
    expect(SETTLEMENT_LAG_HOURS).toBe(24);
  });
});

describe("isAttributableKind", () => {
  it("returns true for pause and refresh_creative", () => {
    expect(isAttributableKind("pause")).toBe(true);
    expect(isAttributableKind("refresh_creative")).toBe(true);
  });

  it("returns false for scale, shift_budget_to_source, and unknown", () => {
    expect(isAttributableKind("scale")).toBe(false);
    expect(isAttributableKind("shift_budget_to_source")).toBe(false);
    expect(isAttributableKind("bogus")).toBe(false);
    expect(isAttributableKind(undefined)).toBe(false);
  });
});
