import { describe, it, expect } from "vitest";
import { buildLanguageInstruction } from "../language-support.js";

describe("buildLanguageInstruction", () => {
  it("returns instruction for detected language", () => {
    const result = buildLanguageInstruction("zh", ["en", "zh", "ms"]);
    expect(result).toContain("zh");
    expect(result).toContain("Continue");
  });

  it("returns available languages instruction when no detected language", () => {
    const result = buildLanguageInstruction(null, ["en", "zh"]);
    expect(result).toContain("en");
    expect(result).toContain("zh");
    expect(result).toContain("Match the customer");
  });

  it("returns empty string when no language config", () => {
    const result = buildLanguageInstruction(null, []);
    expect(result).toBe("");
  });
});
