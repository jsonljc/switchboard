// packages/core/src/agent-home/__tests__/targets.test.ts
import { describe, expect, it } from "vitest";
import { getAgentTargets } from "../targets.js";

describe("getAgentTargets", () => {
  it("reads both keys when present", () => {
    expect(getAgentTargets({ config: { avgValueCents: 17900, targetCpbCents: 3000 } })).toEqual({
      avgValueCents: 17900,
      targetCpbCents: 3000,
    });
  });

  it("returns null for missing keys", () => {
    expect(getAgentTargets({ config: {} })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
  });

  it("returns null when one key absent", () => {
    expect(getAgentTargets({ config: { avgValueCents: 17900 } })).toEqual({
      avgValueCents: 17900,
      targetCpbCents: null,
    });
  });

  it("returns null for non-number values", () => {
    expect(getAgentTargets({ config: { avgValueCents: "17900", targetCpbCents: true } })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
  });

  it("defensive against non-object config", () => {
    expect(getAgentTargets({ config: null })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
    expect(getAgentTargets({ config: "not-an-object" })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
    expect(getAgentTargets({ config: 42 })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
  });

  it("rejects negative or non-finite numbers", () => {
    expect(getAgentTargets({ config: { avgValueCents: -10, targetCpbCents: Number.NaN } })).toEqual(
      { avgValueCents: null, targetCpbCents: null },
    );
  });
});
