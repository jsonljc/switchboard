import { describe, it, expect } from "vitest";
import { translateFrictions } from "../ugc/funnel-friction-translator.js";
import type { FunnelFriction } from "@switchboard/schemas";

function makeFriction(
  overrides: Partial<FunnelFriction> & { frictionType: FunnelFriction["frictionType"] },
): FunnelFriction {
  return {
    id: "f_1",
    deploymentId: "dep_1",
    source: "manual",
    confidence: "medium",
    evidenceCount: 3,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

describe("translateFrictions", () => {
  it("returns empty weights when no frictions", () => {
    const result = translateFrictions([]);
    expect(result.structurePriorities).toEqual({});
    expect(result.motivatorPriorities).toEqual({});
    expect(result.scriptConstraints).toEqual([]);
    expect(result.hookDirectives).toEqual([]);
  });

  it("translates low_trust to social_proof + confession + before_after structures", () => {
    const result = translateFrictions([makeFriction({ frictionType: "low_trust" })]);
    expect(result.structurePriorities["social_proof"]).toBeGreaterThan(0);
    expect(result.structurePriorities["confession"]).toBeGreaterThan(0);
    expect(result.structurePriorities["before_after"]).toBeGreaterThan(0);
  });

  it("translates price_shock to value + cost_of_inaction + comparison motivators", () => {
    const result = translateFrictions([makeFriction({ frictionType: "price_shock" })]);
    expect(result.motivatorPriorities["value"]).toBeGreaterThan(0);
    expect(result.motivatorPriorities["cost_of_inaction"]).toBeGreaterThan(0);
    expect(result.motivatorPriorities["comparison"]).toBeGreaterThan(0);
  });

  it("translates expectation_mismatch to demo_first + myth_buster + script constraint", () => {
    const result = translateFrictions([makeFriction({ frictionType: "expectation_mismatch" })]);
    expect(result.structurePriorities["demo_first"]).toBeGreaterThan(0);
    expect(result.structurePriorities["myth_buster"]).toBeGreaterThan(0);
    expect(result.scriptConstraints).toContain("set clear expectations early");
  });

  it("translates weak_hook to hook directive", () => {
    const result = translateFrictions([makeFriction({ frictionType: "weak_hook" })]);
    expect(result.hookDirectives.length).toBeGreaterThan(0);
  });

  it("merges multiple frictions", () => {
    const result = translateFrictions([
      makeFriction({ frictionType: "low_trust" }),
      makeFriction({ frictionType: "price_shock" }),
    ]);
    expect(result.structurePriorities["social_proof"]).toBeGreaterThan(0);
    expect(result.motivatorPriorities["value"]).toBeGreaterThan(0);
  });

  it("prioritizes high-confidence frictions over low-confidence", () => {
    const result = translateFrictions([
      makeFriction({ frictionType: "low_trust", confidence: "high", evidenceCount: 10 }),
      makeFriction({ frictionType: "price_shock", confidence: "low", evidenceCount: 1 }),
    ]);
    // High-confidence friction should have stronger weight
    const trustWeight = result.structurePriorities["social_proof"] ?? 0;
    const priceWeight = result.motivatorPriorities["value"] ?? 0;
    expect(trustWeight).toBeGreaterThan(priceWeight);
  });
});
