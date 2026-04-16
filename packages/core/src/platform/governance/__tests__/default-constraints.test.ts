import { describe, it, expect } from "vitest";
import {
  DEFAULT_CARTRIDGE_CONSTRAINTS,
  CONSTRAINT_PROFILE_CARTRIDGE_V1,
} from "../default-constraints.js";

describe("DEFAULT_CARTRIDGE_CONSTRAINTS", () => {
  it("has the cartridge-v1 profile name", () => {
    expect(CONSTRAINT_PROFILE_CARTRIDGE_V1).toBe("default-cartridge-v1");
  });

  it("has conservative defaults for cartridge mode", () => {
    expect(DEFAULT_CARTRIDGE_CONSTRAINTS.trustLevel).toBe("guided");
    expect(DEFAULT_CARTRIDGE_CONSTRAINTS.maxToolCalls).toBeGreaterThan(0);
    expect(DEFAULT_CARTRIDGE_CONSTRAINTS.maxLlmTurns).toBeGreaterThan(0);
    expect(DEFAULT_CARTRIDGE_CONSTRAINTS.maxTotalTokens).toBe(0);
    expect(DEFAULT_CARTRIDGE_CONSTRAINTS.maxRuntimeMs).toBeGreaterThan(0);
    expect(DEFAULT_CARTRIDGE_CONSTRAINTS.maxWritesPerExecution).toBeGreaterThan(0);
  });

  it("sets model tiers to default only (cartridges don't use LLMs)", () => {
    expect(DEFAULT_CARTRIDGE_CONSTRAINTS.allowedModelTiers).toEqual(["default"]);
  });
});
