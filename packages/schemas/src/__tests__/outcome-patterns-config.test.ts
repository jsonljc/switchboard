import { describe, it, expect } from "vitest";
import {
  OutcomePatternsConfigSchema,
  resolveOutcomePatternsConfig,
} from "../outcome-patterns-config.js";

describe("OutcomePatternsConfigSchema", () => {
  it("defaults pilotMode to false", () => {
    expect(OutcomePatternsConfigSchema.parse({})).toEqual({ pilotMode: false });
  });

  it("accepts pilotMode override", () => {
    expect(OutcomePatternsConfigSchema.parse({ pilotMode: true })).toEqual({ pilotMode: true });
  });
});

describe("resolveOutcomePatternsConfig", () => {
  it("returns defaults when inputConfig is null/undefined/empty", () => {
    expect(resolveOutcomePatternsConfig(null)).toEqual({ pilotMode: false });
    expect(resolveOutcomePatternsConfig(undefined)).toEqual({ pilotMode: false });
    expect(resolveOutcomePatternsConfig({})).toEqual({ pilotMode: false });
  });

  it("returns defaults when inputConfig.outcomePatterns is absent", () => {
    expect(resolveOutcomePatternsConfig({ unrelated: 1 })).toEqual({ pilotMode: false });
  });

  it("reads pilotMode from inputConfig.outcomePatterns when present", () => {
    expect(resolveOutcomePatternsConfig({ outcomePatterns: { pilotMode: true } })).toEqual({
      pilotMode: true,
    });
  });
});
