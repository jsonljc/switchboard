import { describe, expect, it } from "vitest";
import { routeRecommendation } from "../router.js";

describe("routeRecommendation — Balanced mode", () => {
  it("routes high-confidence reversible low-risk to shadow_action", () => {
    expect(routeRecommendation({ confidence: 0.9, dollarsAtRisk: 25, action: "pause" })).toBe(
      "shadow_action",
    );
    expect(routeRecommendation({ confidence: 0.85, dollarsAtRisk: 0, action: "pause" })).toBe(
      "shadow_action",
    );
    expect(
      routeRecommendation({ confidence: 0.95, dollarsAtRisk: 49.99, action: "reduce_budget" }),
    ).toBe("shadow_action");
  });

  it("routes high-confidence reversible high-risk to queue", () => {
    expect(routeRecommendation({ confidence: 0.9, dollarsAtRisk: 50, action: "pause" })).toBe(
      "queue",
    );
    expect(
      routeRecommendation({ confidence: 0.95, dollarsAtRisk: 100, action: "reduce_budget" }),
    ).toBe("queue");
  });

  it("routes high-confidence non-reversible to queue regardless of risk", () => {
    for (const action of [
      "add_creative",
      "consolidate",
      "kill",
      "expand_targeting",
      "shift_budget",
    ]) {
      expect(routeRecommendation({ confidence: 0.99, dollarsAtRisk: 0, action })).toBe("queue");
    }
  });

  it("routes mid-confidence to queue", () => {
    expect(routeRecommendation({ confidence: 0.5, dollarsAtRisk: 0, action: "pause" })).toBe(
      "queue",
    );
    expect(routeRecommendation({ confidence: 0.84, dollarsAtRisk: 25, action: "pause" })).toBe(
      "queue",
    );
    expect(routeRecommendation({ confidence: 0.7, dollarsAtRisk: 1000, action: "kill" })).toBe(
      "queue",
    );
  });

  it("routes low-confidence to dropped", () => {
    expect(routeRecommendation({ confidence: 0.49, dollarsAtRisk: 0, action: "pause" })).toBe(
      "dropped",
    );
    expect(routeRecommendation({ confidence: 0, dollarsAtRisk: 0, action: "pause" })).toBe(
      "dropped",
    );
  });

  it("treats exactly-at-threshold as included (>=)", () => {
    expect(routeRecommendation({ confidence: 0.5, dollarsAtRisk: 0, action: "pause" })).toBe(
      "queue",
    );
    expect(routeRecommendation({ confidence: 0.85, dollarsAtRisk: 49.99, action: "pause" })).toBe(
      "shadow_action",
    );
  });
});
