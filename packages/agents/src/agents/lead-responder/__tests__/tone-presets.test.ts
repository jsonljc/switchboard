import { describe, it, expect } from "vitest";
import { getTonePreset, TONE_PRESETS, type TonePreset } from "../tone-presets.js";

describe("tone presets", () => {
  it("returns warm-professional preset by default", () => {
    const preset = getTonePreset(undefined);
    expect(preset).toContain("friendly");
    expect(preset).toContain("receptionist");
  });

  it("returns warm-professional preset when specified", () => {
    const preset = getTonePreset("warm-professional");
    expect(preset).toContain("friendly");
    expect(preset).toContain("receptionist");
  });

  it("returns casual-conversational preset", () => {
    const preset = getTonePreset("casual-conversational");
    expect(preset).toContain("friend");
    expect(preset).toContain("texting");
  });

  it("returns direct-efficient preset", () => {
    const preset = getTonePreset("direct-efficient");
    expect(preset).toContain("concise");
    expect(preset).toContain("point");
  });

  it("falls back to warm-professional for unknown preset", () => {
    const preset = getTonePreset("nonexistent" as TonePreset);
    expect(preset).toBe(TONE_PRESETS["warm-professional"]);
  });

  it("exports all 3 preset keys", () => {
    expect(Object.keys(TONE_PRESETS)).toHaveLength(3);
    expect(Object.keys(TONE_PRESETS)).toEqual(
      expect.arrayContaining(["warm-professional", "casual-conversational", "direct-efficient"]),
    );
  });
});
