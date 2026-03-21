// ---------------------------------------------------------------------------
// Tests for constants, type guards, and handler registry
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { isPlatformType, READ_ACTIONS, failResult, buildHandlerRegistry } from "../constants.js";

describe("isPlatformType", () => {
  it("returns true for valid platforms", () => {
    expect(isPlatformType("meta")).toBe(true);
    expect(isPlatformType("google")).toBe(true);
    expect(isPlatformType("tiktok")).toBe(true);
  });

  it("returns false for invalid platforms", () => {
    expect(isPlatformType("facebook")).toBe(false);
    expect(isPlatformType("")).toBe(false);
    expect(isPlatformType(null)).toBe(false);
    expect(isPlatformType(undefined)).toBe(false);
    expect(isPlatformType(42)).toBe(false);
  });
});

describe("READ_ACTIONS", () => {
  it("contains core read actions", () => {
    expect(READ_ACTIONS.has("digital-ads.platform.connect")).toBe(true);
    expect(READ_ACTIONS.has("digital-ads.funnel.diagnose")).toBe(true);
    expect(READ_ACTIONS.has("digital-ads.health.check")).toBe(true);
    expect(READ_ACTIONS.has("digital-ads.report.performance")).toBe(true);
  });

  it("does not contain write actions", () => {
    expect(READ_ACTIONS.has("digital-ads.campaign.pause")).toBe(false);
    expect(READ_ACTIONS.has("digital-ads.campaign.create")).toBe(false);
    expect(READ_ACTIONS.has("digital-ads.targeting.modify")).toBe(false);
  });
});

describe("failResult", () => {
  it("returns a standard failure ExecuteResult", () => {
    const result = failResult("Something failed", "test_step", "test error");
    expect(result.success).toBe(false);
    expect(result.summary).toBe("Something failed");
    expect(result.rollbackAvailable).toBe(false);
    expect(result.partialFailures).toEqual([{ step: "test_step", error: "test error" }]);
    expect(result.durationMs).toBe(0);
    expect(result.undoRecipe).toBeNull();
    expect(result.externalRefs).toEqual({});
  });
});

describe("buildHandlerRegistry", () => {
  it("returns a non-empty Map of handlers", () => {
    const registry = buildHandlerRegistry();
    expect(registry).toBeInstanceOf(Map);
    expect(registry.size).toBeGreaterThan(0);
  });

  it("contains expected domain handler entries", () => {
    const registry = buildHandlerRegistry();
    // Spot-check a few entries from different domain handlers
    expect(registry.has("digital-ads.report.performance")).toBe(true);
    expect(registry.has("digital-ads.strategy.recommend")).toBe(true);
    expect(registry.has("digital-ads.pacing.check")).toBe(true);
  });

  it("all registry values are functions", () => {
    const registry = buildHandlerRegistry();
    for (const [_key, handler] of registry) {
      expect(typeof handler).toBe("function");
    }
  });
});
